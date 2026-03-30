import initDatabase from '../config/init.js';
import User from '../models/user.js';

async function checkUserPreferences() {
  await initDatabase();
  const users = await User.findAll();
  console.log('Users and their preferences:');
  users.forEach(user => {
    console.log('\nUser:', user.email);
    console.log('Preferences:', JSON.stringify(user.preferences, null, 2));
    console.log('Location:', JSON.stringify(user.location, null, 2));
  });
  process.exit(0);
}

checkUserPreferences(); 