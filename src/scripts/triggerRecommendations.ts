import Event from '../models/event.js';
import User from '../models/user.js';
import recommendationEngine from '../services/recommendationEngine.js';
import sequelize from '../config/database.js';

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

    // Send email recommendations
    await recommendationEngine.generateAndSendRecommendations();
  }
}

async function main() {
  try {
    await sequelize.authenticate();
    console.log('Connected to database');

    await showRecommendations();

    await sequelize.close();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main(); 