import express, { Request, Response } from 'express';
import calendarService from '../services/calendarService.js';

const router = express.Router();

/**
 * Step 1: Redirect user to Google OAuth consent screen
 * GET /auth/google
 */
router.get('/google', (req: Request, res: Response) => {
  try {
    const state = req.query.state as string | undefined;
    const authUrl = calendarService.getAuthUrl(state);
    res.redirect(authUrl);
  } catch (error: any) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({ error: 'OAuth configuration error' });
  }
});

/**
 * Step 2: Google redirects back here with ?code=...
 * GET /auth/google/callback
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const error = req.query.error as string | undefined;

  if (error) {
    console.error('Google OAuth error:', error);
    return res.redirect('/?auth=error');
  }

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const { user, isNew } = await calendarService.handleCallback(code);

    // Store user ID in session cookie
    (req as any).session = (req as any).session ?? {};
    (req as any).session.userId = user.id;
    res.cookie('kno_user_id', String(user.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    if (isNew || !user.onboarding_complete) {
      // New user — send to onboarding (cookie is set, no uid needed in URL)
      return res.redirect('/?step=2');
    }

    // Returning user — send to proposals
    return res.redirect('/proposals');
  } catch (err: any) {
    console.error('Error handling OAuth callback:', err);
    return res.redirect('/?auth=error');
  }
});

/**
 * GET /auth/logout — clears the session cookie
 */
router.get('/logout', (req: Request, res: Response) => {
  res.clearCookie('kno_user_id');
  res.redirect('/');
});

export default router;
