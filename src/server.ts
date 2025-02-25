import express from 'express';
import cron from 'node-cron';
import dotenv from 'dotenv';

import apiRoutes from './routes/api.js';
import recommendationEngine from './services/recommendationEngine.js';
import { Scraper } from './services/scraper.js';
import initDatabase from './config/init.js';
import Event from './models/event.js';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize database
await initDatabase();

// API routes
app.use('/api', apiRoutes);

// Schedule scraping job to run at 3 PM every Monday
cron.schedule('0 15 * * 1', async () => {
  console.log('Starting weekly event scraping...');
  try {
    const scraper = new Scraper();
    
    // Scrape from Google Sheets
    console.log('\n=== Scraping from Google Sheets ===');
    const sheetEvents = await scraper.scrapeGoogleSpreadsheet();
    console.log(`Found ${sheetEvents.length} events from Google Sheets`);

    // Scrape from GoldenBuzz for multiple neighborhoods
    console.log('\n=== Scraping from GoldenBuzz ===');
    const neighborhoods = ['highlands', 'lodo', 'rino', 'lohi', 'capitol-hill'];
    const goldenBuzzEvents = [];
    
    for (const neighborhood of neighborhoods) {
      console.log(`Scraping ${neighborhood}...`);
      const events = await scraper.scrapeGoldenBuzz(neighborhood);
      goldenBuzzEvents.push(...events);
      console.log(`Found ${events.length} events in ${neighborhood}`);
      
      // Add a small delay between neighborhood scrapes
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log(`Found ${goldenBuzzEvents.length} total events from GoldenBuzz`);

    // Combine and save all events
    const allEvents = [...sheetEvents, ...goldenBuzzEvents];
    console.log(`\nTotal events found: ${allEvents.length}`);

    let savedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;

    for (const event of allEvents) {
      if (!event.title || !event.description) {
        console.warn('Skipping event with missing required fields');
        errorCount++;
        continue;
      }

      try {
        const [savedEvent, created] = await Event.findOrCreate({
          where: {
            title: event.title,
            source: event.source || 'local_blog'
          },
          defaults: {
            ...event,
            source: event.source || 'local_blog',
            type: 'bar',
            is_active: true,
            recurring: true,
            last_checked: new Date()
          }
        });

        if (created) {
          console.log(`Created new event: ${event.title}`);
          savedCount++;
        } else {
          await savedEvent.update({
            ...event,
            source: event.source || 'local_blog',
            type: 'bar',
            is_active: true,
            recurring: true,
            last_checked: new Date()
          });
          console.log(`Updated existing event: ${event.title}`);
          updatedCount++;
        }
      } catch (error) {
        console.error(`Error saving event ${event.title}:`, error);
        errorCount++;
      }
    }

    console.log('\n=== Scraping Summary ===');
    console.log(`Total events found: ${allEvents.length}`);
    console.log(`New events saved: ${savedCount}`);
    console.log(`Events updated: ${updatedCount}`);
    console.log(`Errors/Skipped: ${errorCount}`);

    console.log('Event scraping completed successfully');
  } catch (error) {
    console.error('Error during event scraping:', error);
  }
});

// Schedule daily recommendation job at 5:50 PM MST (00:50 UTC)
cron.schedule('50 0 * * *', async () => {
  console.log('Starting daily recommendations...');
  try {
    // Verify database state before sending recommendations
    const totalEvents = await Event.count();
    const activeEvents = await Event.count({ where: { is_active: true } });
    
    console.log('\n=== Database State ===');
    console.log(`Total events: ${totalEvents}`);
    console.log(`Active events: ${activeEvents}`);

    if (activeEvents === 0) {
      console.warn('No active events found. Skipping recommendations.');
      return;
    }

    // Generate and send recommendations
    await recommendationEngine.generateAndSendRecommendations();
    console.log('Recommendations sent successfully');
  } catch (error) {
    console.error('Error sending recommendations:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 