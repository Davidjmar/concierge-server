import { jest } from '@jest/globals';
import sequelize from '../src/config/database.js';
import User from '../src/models/user.js';
import Event from '../src/models/event.js';
import * as dotenv from 'dotenv';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Mock modules
jest.mock('@googlemaps/google-maps-services-js', () => {
  return {
    __esModule: true,
    Client: class {
      geocode() {
        return Promise.resolve({
          data: {
            results: [{
              geometry: {
                location: {
                  lat: 39.7392,
                  lng: -104.9847
                }
              }
            }]
          }
        });
      }
    }
  };
});

jest.mock('../src/services/geocodingService.js', () => ({
  __esModule: true,
  default: {
    getCoordinates: jest.fn(),
    geocodeAddress: jest.fn(),
    batchGeocode: jest.fn(),
    isWithinDenver: jest.fn()
  }
}));

jest.mock('../src/services/emailService.js', () => ({
  __esModule: true,
  default: {
    sendRecommendations: jest.fn()
  }
}));

// Database setup
beforeAll(async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: true });

    // Set up mocks
    const mockCoordinates = [39.7392, -104.9847] as [number, number];
    const geocodingService = await import('../src/services/geocodingService.js');
    jest.spyOn(geocodingService.default, 'getCoordinates').mockResolvedValue(mockCoordinates);
    jest.spyOn(geocodingService.default, 'geocodeAddress').mockResolvedValue(mockCoordinates);
    jest.spyOn(geocodingService.default, 'batchGeocode').mockResolvedValue(new Map([['/test', mockCoordinates]]));

    const emailService = await import('../src/services/emailService.js');
    jest.spyOn(emailService.default, 'sendRecommendations').mockResolvedValue({ success: true, sent: 2 });
  } catch (error) {
    console.error('Unable to connect to the database:', error);
    throw error;
  }
});

// Cleanup
afterAll(async () => {
  await sequelize.close();
});

// Reset data before each test
beforeEach(async () => {
  await User.destroy({ where: {}, force: true });
  await Event.destroy({ where: {}, force: true });
  jest.clearAllMocks();
}); 