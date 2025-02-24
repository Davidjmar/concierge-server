import initDatabase from '../config/init.js';
import Event from '../models/event.js';
import geocodingService from '../services/geocodingService.js';
import { Op, literal } from 'sequelize';

async function updateEventCoordinates() {
  try {
    // Initialize database connection
    await initDatabase();
    console.log('Database connected successfully');

    // Find all events with [0, 0] coordinates using a raw query condition
    const events = await Event.findAll({
      where: literal(`location->>'coordinates' = '[0, 0]'`)
    });

    console.log(`Found ${events.length} events with empty coordinates`);

    let updatedCount = 0;
    let failedCount = 0;

    for (const event of events) {
      if (!event.location.address) {
        console.log(`Skipping event "${event.title}" - no address available`);
        failedCount++;
        continue;
      }

      console.log(`\nProcessing: ${event.title}`);
      console.log(`Address: ${event.location.address}`);

      const coordinates = await geocodingService.getCoordinates(event.location.address);
      
      if (coordinates) {
        await event.update({
          location: {
            ...event.location,
            coordinates: coordinates
          }
        });
        console.log(`Updated coordinates to: [${coordinates.join(', ')}]`);
        updatedCount++;
      } else {
        console.log(`Failed to geocode address: ${event.location.address}`);
        failedCount++;
      }

      // Add a small delay to avoid hitting rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\nSummary:');
    console.log(`Total events processed: ${events.length}`);
    console.log(`Successfully updated: ${updatedCount}`);
    console.log(`Failed to update: ${failedCount}`);

  } catch (error) {
    console.error('Error updating coordinates:', error);
  } finally {
    process.exit(0);
  }
}

updateEventCoordinates(); 