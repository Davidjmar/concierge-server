import request from 'supertest';
import express from 'express';
import apiRoutes from '../../src/routes/api.js';
import User from '../../src/models/user.js';
import sequelize from '../../src/config/database.js';

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

let server: any;

describe('API Routes Test', () => {
  beforeAll(done => {
    server = app.listen(0, done);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(async () => {
    // Clear users table before each test
    await User.destroy({ where: {} });
  });

  it('should create a new user', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({
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
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('test@test.com');
  });

  it('should get user by email', async () => {
    // First create a user
    await User.create({
      email: 'test@test.com',
      preferences: {
        concerts: true,
        cocktailBars: false,
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
    });

    // Then get the user
    const res = await request(app)
      .get('/api/users/test@test.com');

    expect(res.statusCode).toBe(200);
    expect(res.body.email).toBe('test@test.com');
  });
}); 