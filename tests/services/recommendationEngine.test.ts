import RecommendationEngine from '../../src/services/recommendationEngine.js';
import User from '../../src/models/user.js';
import Event from '../../src/models/event.js';
import { UserPreferences } from '../../src/types/index.js';

describe('RecommendationEngine Test', () => {
  beforeEach(async () => {
    // Clear tables before each test
    await User.destroy({ where: {} });
    await Event.destroy({ where: {} });
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
        coordinates: [-73.935242, 40.730610]
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
        coordinates: [-73.935242, 40.730610]
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

    // Wait a moment for the indexes to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    const recommendations = await RecommendationEngine.getRecommendationsForUser(user);
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations[0].title).toBe('Test Concert');
  });
}); 