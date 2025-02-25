import { Scraper } from '../services/scraper.js';
import initDatabase from '../config/init.js';
import Event from '../models/event.js';
import type { EventType } from '../types/index.js';

async function renderPopulateEvents() {
  try {
    console.log('Starting database initialization...');
    await initDatabase();
    console.log('Database initialized successfully');

    const scraper = new Scraper();
    
    // Scrape from Google Sheets
    console.log('\n=== Scraping from Google Sheets ===');
    const sheetEvents = await scraper.scrapeGoogleSpreadsheet();
    console.log(`Found ${sheetEvents.length} events from Google Sheets`);

    // Scrape from GoldenBuzz for multiple neighborhoods
    console.log('\n=== Scraping from GoldenBuzz ===');
    const neighborhoods = ['highlands', 'lodo', 'river-north-art-district', 'lohi', 'capitol-hill'];
    const goldenBuzzEvents = [];
    
    for (const neighborhood of neighborhoods) {
      try {
        console.log(`Scraping ${neighborhood}...`);
        const events = await scraper.scrapeGoldenBuzz(neighborhood);
        goldenBuzzEvents.push(...events);
        console.log(`Found ${events.length} events in ${neighborhood}`);
      } catch (error: any) {
        console.error(`Error scraping ${neighborhood}:`, error?.message || 'Unknown error');
      }
      // Add a small delay between neighborhood scrapes
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`Found ${goldenBuzzEvents.length} total events from GoldenBuzz`);

    // Combine all events
    const allEvents = [...sheetEvents, ...goldenBuzzEvents];
    console.log(`\nTotal events found: ${allEvents.length}`);

    // Save events to database
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
            type: 'bar' as EventType,
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
            type: 'bar' as EventType,
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

    // Print summary
    console.log('\n=== Summary ===');
    console.log(`Total events found: ${allEvents.length}`);
    console.log(`New events saved: ${savedCount}`);
    console.log(`Events updated: ${updatedCount}`);
    console.log(`Errors/Skipped: ${errorCount}`);

    // Verify database state
    const totalEvents = await Event.count();
    const activeEvents = await Event.count({ where: { is_active: true } });
    
    console.log('\n=== Final Database State ===');
    console.log(`Total events: ${totalEvents}`);
    console.log(`Active events: ${activeEvents}`);

  } catch (error) {
    console.error('Error in renderPopulateEvents:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

// Run the script
renderPopulateEvents(); 