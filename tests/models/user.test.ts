import User from '../../src/models/user.js';
import { UserPreferences } from '../../src/types/index.js';

describe('User Model Test', () => {
  it('should create & save user successfully', async () => {
    const validUser = {
      email: 'test@test.com',
      preferences: {
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
      },
      location: {
        type: 'Point',
        coordinates: [-73.935242, 40.730610]
      }
    };

    const savedUser = await User.create(validUser);
    expect(savedUser.id).toBeDefined();
    expect(savedUser.email).toBe(validUser.email);
  });

  it('should fail to save user without required fields', async () => {
    const incompleteUser = {
      email: 'test@test.com',
      location: {
        type: 'Point',
        coordinates: [-73.935242, 40.730610]
      }
    } as any;

    await expect(User.create(incompleteUser)).rejects.toThrow();
  });
}); 