import initDatabase from '../config/init.js';
import Event from '../models/event.js';

async function fixEventDates() {
  try {
    // Initialize database connection
    await initDatabase();

    // Find all events with 1970 dates
    const events = await Event.findAll({
      where: {
        source: 'local_blog'
      }
    });

    console.log(`Found ${events.length} events to check`);
    let updatedCount = 0;

    for (const event of events) {
      const startDate = new Date(event.datetime.start);
      if (startDate.getFullYear() === 1970) {
        // Create new dates using today
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        // Keep the original hours and minutes
        start.setHours(startDate.getHours(), startDate.getMinutes(), 0);
        end.setHours(new Date(event.datetime.end).getHours(), new Date(event.datetime.end).getMinutes(), 0);

        await event.update({
          datetime: {
            start,
            end
          }
        });

        console.log(`Updated dates for: ${event.title}`);
        console.log(`  Old start: ${startDate.toLocaleString()}`);
        console.log(`  New start: ${start.toLocaleString()}`);
        updatedCount++;
      }
    }

    console.log(`\nSummary:`);
    console.log(`Checked ${events.length} events`);
    console.log(`Updated ${updatedCount} events with incorrect dates`);

  } catch (error) {
    console.error('Error fixing event dates:', error);
  } finally {
    process.exit(0);
  }
}

fixEventDates(); 