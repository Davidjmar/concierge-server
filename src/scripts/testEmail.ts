import dotenv from 'dotenv';
import Event from '../models/event.js';
import User from '../models/user.js';
import emailService from '../services/emailService.js';
import recommendationEngine from '../services/recommendationEngine.js';
import sequelize from '../config/database.js';
import initDatabase from '../config/init.js';

dotenv.config();

async function testEmailService() {
  try {
    // Initialize database
    await initDatabase();
    console.log('Database initialized');

    // Update some events with different price ranges
    await Event.update(
      { price: { min: 25, max: 30 } },
      { where: { title: 'Happy Hour at Ocean Prime' } }
    );

    await Event.update(
      { price: { min: 35, max: 45 } },
      { where: { title: 'Happy Hour at Bar Dough' } }
    );

    // First, let's check how many events we have in total
    const totalEvents = await Event.count();
    console.log(`Total events in database: ${totalEvents}`);

    // Check how many bar events we have
    const barEvents = await Event.count({
      where: {
        type: 'bar'
      }
    });
    console.log(`Total bar events: ${barEvents}`);

    // Check how many active events we have
    const activeEvents = await Event.count({
      where: {
        is_active: true
      }
    });
    console.log(`Total active events: ${activeEvents}`);

    // Check how many recurring events we have
    const recurringEvents = await Event.count({
      where: {
        recurring: true
      }
    });
    console.log(`Total recurring events: ${recurringEvents}`);

    // Create a test user if it doesn't exist
    const [testUser] = await User.findOrCreate({
      where: { email: 'dj22martin@gmail.com' },
      defaults: {
        email: 'dj22martin@gmail.com',
        preferences: {
          cocktailBars: true,
          concerts: true,
          painting: false,
          watches: false,
          walkingDistance: false,
          speedDating: false,
          maxDistance: 10,
          priceRange: {
            min: 0,
            max: 50
          }
        },
        location: {
          type: 'Point',
          coordinates: [-104.9847, 39.7392] // Denver coordinates
        }
      }
    });

    // Get recommendations using the recommendation engine
    const recommendations = await recommendationEngine.getRecommendationsForUser(testUser);
    
    console.log(`\nFound ${recommendations.length} recommendations across different price ranges:`);
    recommendations.forEach((event, index) => {
      console.log(`\nRecommendation ${index + 1}:`);
      console.log(`Title: ${event.title}`);
      console.log(`Type: ${event.type}`);
      console.log(`Price Range: $${event.price?.min} - $${event.price?.max}`);
      console.log(`Active: ${event.is_active}`);
      console.log(`Recurring: ${event.recurring}`);
      if (event.recurring && event.recurrence_pattern) {
        console.log(`Days: ${event.recurrence_pattern.dayOfWeek.join(',')}`);
      }
    });

    // Send test email
    const result = await emailService.sendRecommendations('dj22martin@gmail.com', recommendations);
    console.log('Email send result:', result);

    // Record that we sent these recommendations
    await recommendationEngine.recordSentRecommendations(testUser.id, recommendations);

    await sequelize.close();
  } catch (error) {
    console.error('Error in test:', error);
    await sequelize.close();
    process.exit(1);
  }
}

testEmailService(); 