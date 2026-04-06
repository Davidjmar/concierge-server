import express from 'express';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import recommendationEngine from './services/recommendationEngine.js';
import { Scraper } from './services/scraper.js';
import { requireDebugSecret } from './middleware/auth.js';
import initDatabase from './config/init.js';
import Event from './models/event.js';
import { DENVER } from './config/cities.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use(cookieParser());

// ── Static assets (onboarding UI, proposals) ─────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api', apiRoutes);
app.use('/auth', authRoutes);

app.get('/proposals', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'proposals.html'));
});

app.get('/settings', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// ── Database init ─────────────────────────────────────────────────────────────
await initDatabase();

// ─────────────────────────────────────────────────────────────────────────────
// Cron Schedule (all times UTC):
//
//  Eventbrite:           Monday 3 AM UTC        (weekly)
//  Westword:             Daily 5 AM UTC
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


// ── Westword — daily 5 AM UTC (11 PM MDT) ────────────────────────────────────
cron.schedule('0 5 * * *', async () => {
  console.log('[Cron] Westword scrape starting…');
  try {
    const scraper = new Scraper();
    const events = await scraper.scrapeWestword();
    await upsertRawEvents(events, 'Westword');
  } catch (err) {
    console.error('[Cron] Westword error:', err);
  }
});

// ── Debug: trigger scrapes on-demand (secret-gated) ──────────────────────────

app.post('/api/debug/scrape-westword', requireDebugSecret, async (_req, res) => {
  try {
    const scraper = new Scraper();
    const events = await scraper.scrapeWestword();
    await upsertRawEvents(events, 'Westword');
    res.json({ ok: true, count: events.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
});

app.post('/api/debug/scrape-goldenbuzz', requireDebugSecret, async (_req, res) => {
  try {
    const scraper = new Scraper();
    const all: Partial<Event>[] = [];
    for (const neighborhood of DENVER.goldenBuzzNeighborhoods) {
      const events = await scraper.scrapeGoldenBuzz(neighborhood);
      all.push(...events);
      await delay(1500);
    }
    await upsertEvents(all, 'GoldenBuzz');
    res.json({ ok: true, count: all.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
});

app.post('/api/debug/scrape-eventbrite', requireDebugSecret, async (_req, res) => {
  try {
    const scraper = new Scraper();
    const events = await scraper.scrapeEventbrite({
      type: 'Point',
      coordinates: [DENVER.center.lng, DENVER.center.lat],
    });
    await upsertRawEvents(events, 'Eventbrite');
    res.json({ ok: true, count: events.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
});


app.post('/api/debug/scrape-sheets', requireDebugSecret, async (_req, res) => {
  try {
    const scraper = new Scraper();
    const events = await scraper.scrapeGoogleSpreadsheet();
    await upsertEvents(events, 'GoogleSheets');
    res.json({ ok: true, count: events.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
});

// Runs all sources sequentially — long-running (~5-10 min), check server logs
app.post('/api/debug/scrape-all', requireDebugSecret, async (_req, res) => {
  // Respond immediately so the HTTP connection doesn't time out
  res.json({ ok: true, message: 'Scrape started — check server logs for progress' });

  const scraper = new Scraper();
  const results: Record<string, number> = {};

  console.log('[ScrapeAll] Starting full scrape run…');

  try {
    console.log('[ScrapeAll] Westword…');
    const ww = await scraper.scrapeWestword();
    await upsertRawEvents(ww, 'Westword');
    results.westword = ww.length;
  } catch (err) { console.error('[ScrapeAll] Westword error:', err); }

  try {
    console.log('[ScrapeAll] GoldenBuzz…');
    const gb: Partial<Event>[] = [];
    for (const neighborhood of DENVER.goldenBuzzNeighborhoods) {
      const ev = await scraper.scrapeGoldenBuzz(neighborhood);
      gb.push(...ev);
      await delay(1500);
    }
    await upsertEvents(gb, 'GoldenBuzz');
    results.goldenbuzz = gb.length;
  } catch (err) { console.error('[ScrapeAll] GoldenBuzz error:', err); }

  try {
    console.log('[ScrapeAll] Eventbrite…');
    const eb = await scraper.scrapeEventbrite({
      type: 'Point',
      coordinates: [DENVER.center.lng, DENVER.center.lat],
    });
    await upsertRawEvents(eb, 'Eventbrite');
    results.eventbrite = eb.length;
  } catch (err) { console.error('[ScrapeAll] Eventbrite error:', err); }

  try {
    console.log('[ScrapeAll] Google Sheets…');
    const sheets = await scraper.scrapeGoogleSpreadsheet();
    await upsertEvents(sheets, 'GoogleSheets');
    results.sheets = sheets.length;
  } catch (err) { console.error('[ScrapeAll] Google Sheets error:', err); }

  console.log('[ScrapeAll] Done.', results);
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
