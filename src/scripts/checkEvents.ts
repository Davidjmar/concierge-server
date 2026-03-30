import initDatabase from '../config/init.js';
import Event from '../models/event.js';

async function checkEvents() {
  await initDatabase();
  const events = await Event.findAll({
    where: {
      is_active: true
    }
  });
  
  console.log(`Found ${events.length} active events:\n`);
  events.forEach(event => {
    console.log('Title:', event.title);
    console.log('Type:', event.type);
    console.log('Price:', JSON.stringify(event.price));
    console.log('Location:', JSON.stringify(event.location));
    console.log('Recurring:', event.recurring);
    if (event.recurring && event.recurrence_pattern) {
      console.log('Days:', event.recurrence_pattern.dayOfWeek.join(','));
    }
    console.log('Is Active:', event.is_active);
    console.log('---\n');
  });
  process.exit(0);
}

checkEvents(); 