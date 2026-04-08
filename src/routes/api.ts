import express, { Request, Response } from 'express';
import multer from 'multer';
import Anthropic from '@anthropic-ai/sdk';
import User from '../models/user.js';
import Event from '../models/event.js';
import UserEventRecommendation from '../models/userEventRecommendation.js';
import geocodingService from '../services/geocodingService.js';
import recommendationEngine from '../services/recommendationEngine.js';
import { requireAuth, requireDebugSecret } from '../middleware/auth.js';
import { UserPreferencesV2, GeoPoint } from '../types/index.js';
import { getCityUTCOffset, toCityLocalDate } from '../utils/timezone.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    const { days, delivery_timing } = req.body;
    await req.user!.update({
      recommendation_days: days,
      delivery_timing: delivery_timing ?? 'day_of',
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
      days: u.recommendation_days,
      delivery_timing: u.delivery_timing ?? 'day_of',
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

    const { reason, re_search_hint } = req.body ?? {};
    const hasHint = typeof re_search_hint === 'string' && re_search_hint.trim().length > 0;

    await rec.update({
      user_response: 'deleted',
      response_detected_at: new Date(),
      pass_reason: reason ?? null,
      re_search_hint: hasHint ? re_search_hint.trim() : null,
      needs_replacement: hasHint,
    });
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Find me something else ───────────────────────────────────────────────────

router.post('/proposals/:id/find-something-else', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const rec = await UserEventRecommendation.findOne({
      where: { id, user_id: req.user!.id },
      include: [{ model: Event, attributes: ['datetime'] }],
    });
    if (!rec) return res.status(404).json({ error: 'Proposal not found' });

    const { re_search_hint } = req.body ?? {};
    const hint = typeof re_search_hint === 'string' && re_search_hint.trim() ? re_search_hint.trim() : null;

    await rec.update({
      user_response: 'deleted',
      response_detected_at: new Date(),
      pass_reason: 'find_something_else',
      re_search_hint: hint,
      needs_replacement: true,
    });

    // Derive the target day from the original event's city-local date
    const user = req.user!;
    const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const eventStart = (rec as any).Event?.datetime?.start;
    let targetDays: string[] = [];
    if (eventStart) {
      const localDate = toCityLocalDate(user.city ?? 'denver', new Date(eventStart));
      targetDays = [DAY_NAMES[localDate.getUTCDay()]];
    }

    // Fire re-run immediately in the background — don't make the client wait
    setImmediate(() => {
      recommendationEngine.runForUser(user, targetDays).catch(err =>
        console.error(`[find-something-else] Error for user ${user.id}:`, err)
      );
    });

    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

// ─── Photo submission ─────────────────────────────────────────────────────────

router.post('/submit/photo', requireAuth, upload.single('photo'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'AI extraction not available' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const base64 = req.file.buffer.toString('base64');
    const mediaType = (req.file.mimetype as any) || 'image/jpeg';

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Extract any event, special, or happy hour details from this image. Return ONLY a JSON object with these fields (use null for anything not visible): { "title": string, "venue_name": string, "description": string, "date_hint": string, "time_hint": string, "price_hint": string, "address_hint": string, "tags": string[] }. For tags use simple lowercase words like: happy_hour, free, concert, food, drinks, live_music, grand_opening, etc.',
          },
        ],
      }],
    });

    const text = (msg.content[0] as any)?.text ?? '';
    let extracted: Record<string, any> = {};
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) extracted = JSON.parse(match[0]);
    } catch { /* return raw text if parse fails */ }

    res.json({ ok: true, extracted, raw: text });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

router.post('/submit/confirm', requireAuth, async (req: Request, res: Response) => {
  try {
    const { title, venue_name, description, date_hint, time_hint, price_hint, address_hint, tags } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    // Parse a rough datetime from the hints (default to 1 week from now if unparseable)
    let startDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (date_hint || time_hint) {
      const parsed = new Date(`${date_hint ?? ''} ${time_hint ?? ''}`.trim());
      if (!isNaN(parsed.getTime())) startDate = parsed;
    }
    const endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);

    // Parse price hint
    let price: { min?: number; max?: number } = {};
    if (price_hint) {
      const match = price_hint.match(/(\d+)/g);
      if (match) {
        price = { min: parseInt(match[0], 10), max: match[1] ? parseInt(match[1], 10) : parseInt(match[0], 10) };
      }
    }

    const event = await Event.create({
      title: title.trim(),
      description: description ?? null,
      source: 'manual',
      source_url: null,
      type: 'social',
      price,
      location: { type: 'Point', coordinates: [-104.9847, 39.7392], address: address_hint ?? null },
      datetime: { start: startDate, end: endDate },
      is_active: true,
      recurring: false,
      city: 'denver',
      venue_name: venue_name ?? null,
      tags: Array.isArray(tags) ? tags : [],
    } as any);

    res.json({ ok: true, event_id: event.id });
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

/**
 * Diagnostic endpoint — returns a JSON breakdown of exactly what the engine
 * sees for the authenticated user: windows, candidate events, scores, and
 * any blocking reasons. Does NOT create calendar events or DB records.
 */
router.get('/debug/explain-recommendations', requireDebugSecret, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.query.userId as string, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'userId query param required' });
    const user = await User.findByPk(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const explanation = await recommendationEngine.explainForUser(user);
    res.json(explanation);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'Unknown error' });
  }
});

export default router;
