import sequelize from './database.js';
import User from '../models/user.js';
import Event from '../models/event.js';

async function initDatabase() {
  try {
    // Test the connection
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');

    // Sync all models — alter:true adds new columns without dropping existing ones
    await sequelize.sync({ alter: true });
    console.log('All models were synchronized successfully.');
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    process.exit(1);
  }
}

export default initDatabase; 