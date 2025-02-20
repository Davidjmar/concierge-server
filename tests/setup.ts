import sequelize from '../src/config/database.js';
import User from '../src/models/user.js';
import Event from '../src/models/event.js';

beforeAll(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: true });
  } catch (error) {
    console.error('Error setting up test database:', error);
    throw error;
  }
});

afterAll(async () => {
  await sequelize.close();
});

beforeEach(async () => {
  try {
    await User.destroy({ where: {}, force: true });
    await Event.destroy({ where: {}, force: true });
  } catch (error) {
    console.error('Error cleaning up test database:', error);
    throw error;
  }
}); 