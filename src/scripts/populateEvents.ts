import { Scraper } from '../services/scraper.js';
import initDatabase from '../config/init.js';
import Event from '../models/event.js';
import type { EventType } from '../types/index.js';

async function populateEvents() {
  try {
    // Initialize database connection
    await initDatabase();
    console.log('Database initialized');

    // Create a new scraper instance
    const scraper = new Scraper();

    // First, try scraping from Google Sheets
    console.log('\n=== Scraping from Google Sheets ===');
    const sheetEvents = await scraper.scrapeGoogleSpreadsheet();
    console.log(`Found ${sheetEvents.length} events from Google Sheets`);

    // Then, try scraping from GoldenBuzz
    console.log('\n=== Scraping from GoldenBuzz ===');
    const goldenBuzzEvents = await scraper.scrapeGoldenBuzz('highlands');
    console.log(`Found ${goldenBuzzEvents.length} events from GoldenBuzz`);

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

      const eventData = {
        title: event.title,
        description: event.description,
        source: 'local_blog' as const,
        source_url: event.source_url || '',
        type: 'bar' as EventType,
        price: event.price || { min: 0, max: 0 },
        location: event.location || { type: 'Point', coordinates: [0, 0], address: '' },
        datetime: event.datetime || { start: new Date(), end: new Date() },
        is_active: true,
        recurring: true,
        recurrence_pattern: event.recurrence_pattern || { 
          frequency: 'weekly',
          dayOfWeek: [0, 1, 2, 3, 4, 5, 6] 
        },
        last_checked: new Date()
      };

      try {
        const [savedEvent, created] = await Event.findOrCreate({
          where: {
            title: eventData.title,
            source: eventData.source
          },
          defaults: eventData
        });

        if (created) {
          console.log(`Created new event: ${eventData.title}`);
          savedCount++;
        } else {
          await savedEvent.update(eventData);
          console.log(`Updated existing event: ${eventData.title}`);
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
    const recurringEvents = await Event.count({ where: { recurring: true } });

    console.log('\n=== Database State ===');
    console.log(`Total events in database: ${totalEvents}`);
    console.log(`Active events: ${activeEvents}`);
    console.log(`Recurring events: ${recurringEvents}`);

  } catch (error) {
    console.error('Error populating events:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
populateEvents(); 