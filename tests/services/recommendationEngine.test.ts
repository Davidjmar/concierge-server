import { jest } from '@jest/globals';
import RecommendationEngine from '../../src/services/recommendationEngine.js';
import User from '../../src/models/user.js';
import Event from '../../src/models/event.js';
import { UserPreferences } from '../../src/types/index.js';
import geocodingService from '../../src/services/geocodingService.js';

describe('RecommendationEngine Test', () => {
  beforeEach(async () => {
    // Clear tables before each test
    await User.destroy({ where: {} });
    await Event.destroy({ where: {} });
    
    // Reset mock counters
    jest.clearAllMocks();
  });

  it('should get recommendations for user', async () => {
    // Create a test user with complete preferences
    const userPreferences: UserPreferences = {
      concerts: true,
      cocktailBars: true,
      painting: false,
      watches: false,
      walkingDistance: false,
      speedDating: false,
      maxDistance: 10,
      priceRange: {
        min: 0,
        max: 100
      }
    };

    const user = await User.create({
      email: 'test@test.com',
      preferences: userPreferences,
      location: {
        type: 'Point',
        coordinates: [-104.9847, 39.7392] // Denver coordinates
      }
    });

    // Create some test events
    await Event.create({
      title: 'Test Concert',
      description: 'Test concert description',
      source: 'eventbrite',
      source_url: 'https://test.com',
      type: 'concert',
      price: {
        min: 10,
        max: 50
      },
      location: {
        type: 'Point',
        coordinates: [-104.9847, 39.7392], // Same coordinates as user
        address: 'Test Location'
      },
      datetime: {
        start: new Date(Date.now() + 1800000), // 30 minutes from now
        end: new Date(Date.now() + 3600000)    // 1 hour from now
      },
      is_active: true,
      recurring: false,
      recurrence_pattern: undefined,
      last_checked: new Date()
    });

    // Create a recurring event
    await Event.create({
      title: 'Happy Hour',
      description: 'Daily happy hour',
      source: 'local_blog',
      source_url: 'https://test.com/happyhour',
      type: 'bar',
      price: {
        min: 5,
        max: 15
      },
      location: {
        type: 'Point',
        coordinates: [-104.9847, 39.7392], // Same coordinates as user
        address: 'Bar Location'
      },
      datetime: {
        start: new Date(Date.now()), // Now
        end: new Date(Date.now() + 7200000) // 2 hours from now
      },
      is_active: true,
      recurring: true,
      recurrence_pattern: {
        frequency: 'weekly',
        dayOfWeek: [0, 1, 2, 3, 4, 5, 6] // Every day
      },
      last_checked: new Date()
    });

    // Wait a moment for the indexes to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    const recommendations = await RecommendationEngine.getRecommendationsForUser(user);
    
    // Verify recommendations
    expect(recommendations.length).toBe(2);
    expect(recommendations.map(r => r.title).sort()).toEqual(['Happy Hour', 'Test Concert'].sort());
    
    // Verify geocoding service was not called (using mocked coordinates)
    expect(geocodingService.getCoordinates).not.toHaveBeenCalled();
  });

  it('should filter out events outside max distance', async () => {
    const user = await User.create({
      email: 'test@test.com',
      preferences: {
        concerts: true,
        cocktailBars: true,
        painting: false,
        watches: false,
        walkingDistance: false,
        speedDating: false,
        maxDistance: 1, // Very small radius
        priceRange: { min: 0, max: 100 }
      },
      location: {
        type: 'Point',
        coordinates: [-104.9847, 39.7392]
      }
    });

    // Create an event far from the user
    await Event.create({
      title: 'Far Event',
      description: 'This event is too far',
      source: 'eventbrite',
      type: 'concert',
      price: { min: 10, max: 50 },
      location: {
        type: 'Point',
        coordinates: [-105.0167, 39.7621], // Different coordinates
        address: 'Far Location'
      },
      datetime: {
        start: new Date(Date.now() + 1800000),
        end: new Date(Date.now() + 3600000)
      },
      is_active: true
    });

    const recommendations = await RecommendationEngine.getRecommendationsForUser(user);
    expect(recommendations.length).toBe(0);
  });
}); 