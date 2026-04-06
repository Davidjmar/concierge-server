import express, { Request, Response } from 'express';
import User from '../models/user.js';
import Event from '../models/event.js';
import UserEventRecommendation from '../models/userEventRecommendation.js';
import geocodingService from '../services/geocodingService.js';
import recommendationEngine from '../services/recommendationEngine.js';
import { requireAuth, requireDebugSecret } from '../middleware/auth.js';
import { UserPreferencesV2, GeoPoint } from '../types/index.js';

const router = express.Router();

// ─── Health (public) ──────────────────────────────────────────────────────────

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await User.count();
    res.json({ status: 'healthy', message: 'Server is running and database is connected' });
  } catch {
    res.status(500).json({ status: 'unhealthy', message: 'Database connection error' });
  }
});

// ─── Auth check — who am I? (used by frontend after page load) ────────────────

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const u = req.user!;
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    onboarding_complete: u.onboarding_complete ?? false,
  });
});

// ─── Onboarding — Step 2: Locations ──────────────────────────────────────────

router.post('/onboarding/locations', requireAuth, async (req: Request, res: Response) => {
  try {
    const { home, work } = req.body;
    if (!home) return res.status(400).json({ error: 'home is required' });

    const user = req.user!;

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

router.post('/onboarding/preferences', requireAuth, async (req: Request, res: Response) => {
  try {
    const { preferences } = req.body;
    await req.user!.update({ preferences });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Onboarding — Step 4: Schedule ───────────────────────────────────────────

router.post('/onboarding/schedule', requireAuth, async (req: Request, res: Response) => {
  try {
    const { frequency, days, max_proposals } = req.body;
    await req.user!.update({
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

// ─── Settings — fetch & save ──────────────────────────────────────────────────

router.get('/settings', requireAuth, (req: Request, res: Response) => {
  const u = req.user!;
  res.json({
    id: u.id,
    email: u.email,
    name: u.name,
    home_location: u.home_location,
    work_location: u.work_location,
    preferences: u.preferences,
    schedule: {
      frequency: u.recommendation_frequency,
      days: u.recommendation_days,
      time: u.recommendation_time,
      max_proposals: u.max_proposals_per_run,
    },
  });
});

// ─── Proposals feed ───────────────────────────────────────────────────────────

router.get('/proposals', requireAuth, async (req: Request, res: Response) => {
  try {
    const proposals = await UserEventRecommendation.findAll({
      where: { user_id: req.user!.id },
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

router.post('/proposals/:id/pass', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const rec = await UserEventRecommendation.findOne({
      where: { id, user_id: req.user!.id },  // ownership check
    });
    if (!rec) return res.status(404).json({ error: 'Proposal not found' });

    await rec.update({ user_response: 'deleted', response_detected_at: new Date() });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Debug endpoints (secret-gated) ──────────────────────────────────────────

router.post('/debug/run-recommendations', requireDebugSecret, async (req: Request, res: Response) => {
  try {
    const { userId } = req.body;
    if (userId) {
      const user = await User.findByPk(parseInt(userId, 10));
      if (!user) return res.status(404).json({ error: 'User not found' });
      await recommendationEngine.runForUser(user);
      res.json({ ok: true, message: `Ran for user ${user.id}` });
    } else {
      await recommendationEngine.runForEligibleUsers();
      res.json({ ok: true, message: 'Ran for all eligible users' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

export default router;
