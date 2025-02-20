import express, { Request, Response } from 'express';
import User from '../models/user.js';
import { UserPreferences, UserLocation } from '../types/index.js';

const router = express.Router();

interface CreateUserRequest {
  email: string;
  preferences: UserPreferences;
  location: UserLocation;
}

// Create/Update user preferences
router.post('/users', async (req: Request<{}, {}, CreateUserRequest>, res: Response) => {
  try {
    const { email, preferences, location } = req.body;
    
    const [user, created] = await User.findOrCreate({
      where: { email },
      defaults: {
        email,
        preferences,
        location
      }
    });

    if (!created) {
      await user.update({ preferences, location });
    }
    
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Unknown error occurred' });
  }
});

// Get user preferences
router.get('/users/:email', async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({
      where: { email: req.params.email }
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Unknown error occurred' });
  }
});

export default router; 