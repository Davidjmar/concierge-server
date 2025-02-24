import { Scraper } from '../services/scraper.js';
import initDatabase from '../config/init.js';
import Event from '../models/event.js';
import type { EventType } from '../types/index.js';

async function testGoogleSheetsScraper() {
  try {
    // Initialize database connection
    await initDatabase();

    // Create a new scraper instance
    const scraper = new Scraper();

    // Try scraping happy hours from the Google Sheet
    const events = await scraper.scrapeGoogleSpreadsheet();

    console.log(`Found ${events.length} happy hour events:`);

    // Save events to database
    let savedCount = 0;
    for (const event of events) {
      if (!event.title || !event.description) {
        console.warn('Skipping event with missing required fields');
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
          savedCount++;
        } else {
          await savedEvent.update(eventData);
        }
      } catch (error) {
        console.error(`Error saving event ${event.title}:`, error);
      }
    }

    console.log(`Successfully saved/updated ${savedCount} events`);

    // Log all events for verification
    events.forEach((event, index) => {
      console.log(`\n${index + 1}. ${event.title}`);
      console.log(`   Description: ${event.description}`);
      console.log(`   Time: ${event.datetime?.start?.toLocaleTimeString()} - ${event.datetime?.end?.toLocaleTimeString()}`);
      console.log(`   Days: ${event.recurrence_pattern?.dayOfWeek?.join(', ')}`);
      if (event.source_url) {
        console.log(`   Website: ${event.source_url}`);
      }
    });

  } catch (error) {
    console.error('Error testing Google Sheets scraper:', error);
  } finally {
    // Close database connection
    process.exit(0);
  }
}

testGoogleSheetsScraper(); 