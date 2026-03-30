import express, { Request, Response } from 'express';
import User from '../models/user.js';
import Event from '../models/event.js';
import UserEventRecommendation from '../models/userEventRecommendation.js';
import geocodingService from '../services/geocodingService.js';
import { UserPreferences, UserLocation, UserPreferencesV2, GeoPoint } from '../types/index.js';
import { Op } from 'sequelize';

const router = express.Router();

// ─── Health ────────────────────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await User.count();
    res.json({ status: 'healthy', message: 'Server is running and database is connected' });
  } catch {
    res.status(500).json({ status: 'unhealthy', message: 'Database connection error' });
  }
});

// ─── Legacy user CRUD (kept for backward compat) ───────────────────────────────

router.post('/users', async (req: Request, res: Response) => {
  try {
    const { email, preferences, location } = req.body;
    const [user, created] = await User.findOrCreate({
      where: { email },
      defaults: { email, preferences, location },
    });
    if (!created) await user.update({ preferences, location });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await User.findAll();
    res.json(users);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

router.get('/users/:email', async (req: Request, res: Response) => {
  try {
    const user = await User.findOne({ where: { email: req.params.email } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Onboarding — Step 2: Locations ───────────────────────────────────────────

router.post('/users/onboarding/locations', async (req: Request, res: Response) => {
  try {
    const { userId, home, work } = req.body;
    if (!userId || !home) return res.status(400).json({ error: 'userId and home are required' });

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const homeCoords = await geocodingService.getCoordinates(`${home}, Denver, CO`);
    const homeLocation: GeoPoint = {
      coordinates: homeCoords ?? [-104.9847, 39.7392],
      address: home,
    };

    const updates: Partial<User> = { home_location: homeLocation };

    if (work) {
      const workCoords = await geocodingService.getCoordinates(`${work}, Denver, CO`);
      updates.work_location = {
        coordinates: workCoords ?? [-104.9847, 39.7392],
        address: work,
      };
    }

    await user.update(updates);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Onboarding — Step 3: Preferences ────────────────────────────────────────

router.post('/users/onboarding/preferences', async (req: Request, res: Response) => {
  try {
    const { userId, preferences } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await user.update({ preferences });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Onboarding — Step 4: Schedule ───────────────────────────────────────────

router.post('/users/onboarding/schedule', async (req: Request, res: Response) => {
  try {
    const { userId, frequency, days, max_proposals } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    await user.update({
      recommendation_frequency: frequency,
      recommendation_days: days,
      max_proposals_per_run: max_proposals ?? 3,
      onboarding_complete: true,
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Proposals feed ───────────────────────────────────────────────────────────

router.get('/proposals/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid userId' });

    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const proposals = await UserEventRecommendation.findAll({
      where: { user_id: userId },
      include: [{ model: Event }],
      order: [['proposed_at', 'DESC']],
      limit: 50,
    });

    res.json({ proposals });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Pass on a proposal ───────────────────────────────────────────────────────

router.post('/proposals/:id/pass', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const rec = await UserEventRecommendation.findByPk(id);
    if (!rec) return res.status(404).json({ error: 'Proposal not found' });

    await rec.update({
      user_response: 'deleted',
      response_detected_at: new Date(),
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

export default router;
