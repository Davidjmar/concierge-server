import Event from '../models/event.js';
import User from '../models/user.js';
import recommendationEngine from '../services/recommendationEngine.js';
import sequelize from '../config/database.js';

async function createSampleEvents() {
  // Clear existing events
  await Event.destroy({ where: {}, force: true });
  console.log('Cleared existing events');

  // Create sample events
  await Event.create({
    title: 'Jazz Night',
    description: 'Live jazz performance',
    source: 'eventbrite',
    source_url: 'https://test.com/jazz',
    type: 'concert',
    price: {
      min: 15,
      max: 30
    },
    location: {
      type: 'Point',
      coordinates: [-73.935242, 40.730610]
    },
    datetime: {
      start: new Date(Date.now() + 3600000), // 1 hour from now
      end: new Date(Date.now() + 3600000 * 3) // 3 hours from now
    },
    is_active: true
  });

  await Event.create({
    title: 'Cocktail Workshop',
    description: 'Learn to make craft cocktails',
    source: 'yelp',
    source_url: 'https://test.com/cocktails',
    type: 'bar',
    price: {
      min: 45,
      max: 60
    },
    location: {
      type: 'Point',
      coordinates: [-73.935242, 40.730610]
    },
    datetime: {
      start: new Date(Date.now() + 3600000 * 2), // 2 hours from now
      end: new Date(Date.now() + 3600000 * 4) // 4 hours from now
    },
    is_active: true
  });
}

async function showRecommendations() {
  const users = await User.findAll();
  
  for (const user of users) {
    console.log('\n=== Recommendations for', user.email, '===');
    console.log('User Preferences:', JSON.stringify(user.preferences, null, 2));
    
    const recommendations = await recommendationEngine.getRecommendationsForUser(user);
    
    console.log('\nRecommended Events:');
    for (const event of recommendations) {
      console.log('\n---');
      console.log('Title:', event.title);
      console.log('Type:', event.type);
      console.log('Description:', event.description);
      console.log('Price:', event.price);
      console.log('When:', new Date(event.datetime.start).toLocaleString());
      console.log('Source:', event.source);
      console.log('Location:', event.location);
    }
    console.log('\n=== End of Recommendations ===\n');
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database');

    await createSampleEvents();
    console.log('Created sample events');

    await showRecommendations();

    await sequelize.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 