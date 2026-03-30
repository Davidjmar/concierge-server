import express from 'express';
import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import recommendationEngine from './services/recommendationEngine.js';
import { Scraper } from './services/scraper.js';
import initDatabase from './config/init.js';
import Event from './models/event.js';
import { DENVER } from './config/cities.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// ── Static assets (onboarding UI, proposals) ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);
app.use('/auth', authRoutes);

// SPA-style fallback: proposals.html is already a static file; serve index for unknown paths
app.get('/proposals', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proposals.html'));
});

// ── Database init ─────────────────────────────────────────────────────────────
await initDatabase();

// ─────────────────────────────────────────────────────────────────────────────
// Cron Schedule (all times UTC):
//
//  Yelp happy hours:     Sunday 2 AM UTC       (weekly)
//  Eventbrite:           Monday 3 AM UTC        (weekly)
//  Westword:             Friday 6 AM UTC        (weekly, after Thu publish)
//  GoldenBuzz:           Monday 3 AM UTC        (weekly, alongside Eventbrite)
//  Google Sheets:        Every 4 hours          (fast feedback loop for manual additions)
//  Calendar feedback:    Every 6 hours          (poll for proposal accept/decline)
//  Recommendation tick:  Every hour at :00      (dispatches per-user schedule)
// ─────────────────────────────────────────────────────────────────────────────

// ── Google Sheets — every 4 hours ─────────────────────────────────────────────
cron.schedule('0 */4 * * *', async () => {
  console.log('[Cron] Google Sheets scrape starting…');
  try {
    const scraper = new Scraper();
    const events = await scraper.scrapeGoogleSpreadsheet();
    await upsertEvents(events, 'Google Sheets');
  } catch (err) {
    console.error('[Cron] Google Sheets error:', err);
  }
});

// ── GoldenBuzz + Eventbrite — Monday 3 AM UTC ─────────────────────────────────
cron.schedule('0 3 * * 1', async () => {
  console.log('[Cron] Monday scrape (GoldenBuzz + Eventbrite) starting…');
  try {
    const scraper = new Scraper();

    // GoldenBuzz — all Denver neighborhoods
    console.log('=== GoldenBuzz ===');
    const allGoldenBuzz = [];
    for (const neighborhood of DENVER.goldenBuzzNeighborhoods) {
      console.log(`  Scraping ${neighborhood}…`);
      const events = await scraper.scrapeGoldenBuzz(neighborhood);
      allGoldenBuzz.push(...events);
      await delay(1500); // be polite
    }
    await upsertEvents(allGoldenBuzz, 'GoldenBuzz');

    // Eventbrite
    console.log('=== Eventbrite ===');
    const ebEvents = await scraper.scrapeEventbrite({
      type: 'Point',
      coordinates: [DENVER.center.lng, DENVER.center.lat],
    });
    await upsertRawEvents(ebEvents, 'Eventbrite');

  } catch (err) {
    console.error('[Cron] Monday scrape error:', err);
  }
});

// ── Yelp — Sunday 2 AM UTC ─────────────────────────────────────────────────────
cron.schedule('0 2 * * 0', async () => {
  console.log('[Cron] Yelp happy hour scrape starting…');
  try {
    const scraper = new Scraper();
    const yelpEvents = await scraper.scrapeYelp(
      { type: 'Point', coordinates: [DENVER.center.lng, DENVER.center.lat] },
      ['bars', 'restaurants', 'pubs', 'cocktailbars']
    );
    await upsertRawEvents(yelpEvents, 'Yelp');
  } catch (err) {
    console.error('[Cron] Yelp error:', err);
  }
});

// ── Westword — Friday 6 AM UTC ────────────────────────────────────────────────
cron.schedule('0 6 * * 5', async () => {
  console.log('[Cron] Westword scrape starting…');
  try {
    const scraper = new Scraper();
    const events = await scraper.scrapeWestword();
    await upsertRawEvents(events, 'Westword');
  } catch (err) {
    console.error('[Cron] Westword error:', err);
  }
});

// ── Calendar feedback polling — every 6 hours ─────────────────────────────────
cron.schedule('0 */6 * * *', async () => {
  console.log('[Cron] Calendar feedback poll starting…');
  try {
    await recommendationEngine.pollCalendarFeedback();
  } catch (err) {
    console.error('[Cron] Feedback poll error:', err);
  }
});

// ── Recommendation tick — every hour ─────────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  console.log('[Cron] Recommendation tick…');
  try {
    const totalEvents = await Event.count({ where: { is_active: true } });
    if (totalEvents === 0) {
      console.warn('[Cron] No active events — skipping recommendations');
      return;
    }
    await recommendationEngine.runForEligibleUsers();
  } catch (err) {
    console.error('[Cron] Recommendation tick error:', err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/** Upsert partial Event objects (from GoldenBuzz / Google Sheets scrapers) */
async function upsertEvents(events: Partial<Event>[], label: string) {
  let saved = 0, updated = 0, errors = 0;

  for (const event of events) {
    if (!event.title) { errors++; continue; }
    try {
      const [record, created] = await Event.findOrCreate({
        where: { title: event.title, source: event.source ?? 'local_blog' },
        defaults: {
          ...event,
          source: event.source ?? 'local_blog',
          type: event.type ?? 'bar',
          is_active: true,
          last_checked: new Date(),
        } as any,
      });

      if (created) {
        saved++;
      } else {
        await record.update({ ...event, last_checked: new Date() });
        updated++;
      }
    } catch (err) {
      console.error(`[${label}] Error upserting "${event.title}":`, err);
      errors++;
    }
  }

  console.log(`[${label}] New: ${saved}, Updated: ${updated}, Errors: ${errors}`);
}

/** Upsert RawEvent objects (from Eventbrite / Yelp / Westword scrapers) */
async function upsertRawEvents(events: any[], label: string) {
  let saved = 0, updated = 0, errors = 0;

  for (const ev of events) {
    if (!ev.title || !ev.sourceUrl) { errors++; continue; }
    try {
      const [record, created] = await Event.findOrCreate({
        where: { source: ev.source ?? 'eventbrite', source_url: ev.sourceUrl },
        defaults: {
          title: ev.title,
          description: ev.description,
          source: ev.source ?? 'eventbrite',
          source_url: ev.sourceUrl,
          type: ev.type ?? 'social',
          price: ev.price,
          location: ev.location,
          datetime: ev.datetime,
          is_active: true,
          recurring: ev.recurring ?? false,
          recurrence_pattern: ev.recurrencePattern,
          city: ev.city ?? 'denver',
          neighborhood: ev.neighborhood,
          venue_name: ev.venueName,
          tags: ev.tags ?? [],
          happy_hour_schedule: ev.happyHourSchedule,
          external_ids: ev.externalIds ?? {},
          image_url: ev.imageUrl,
          last_checked: new Date(),
        },
      });

      if (created) {
        saved++;
      } else {
        await record.update({
          title: ev.title,
          description: ev.description,
          price: ev.price,
          location: ev.location,
          datetime: ev.datetime,
          is_active: true,
          tags: ev.tags ?? [],
          image_url: ev.imageUrl,
          last_checked: new Date(),
        });
        updated++;
      }
    } catch (err) {
      console.error(`[${label}] Error upserting "${ev.title}":`, err);
      errors++;
    }
  }

  console.log(`[${label}] New: ${saved}, Updated: ${updated}, Errors: ${errors}`);
}

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`kno server running on port ${PORT}`);
});
