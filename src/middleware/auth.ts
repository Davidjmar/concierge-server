import { Request, Response, NextFunction } from 'express';
import User from '../models/user.js';

// Extend Express Request to carry the authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * requireAuth — reads the kno_user_id HttpOnly cookie set by /auth/google/callback,
 * loads the user from the DB, and attaches them to req.user.
 *
 * Returns 401 if the cookie is missing or the user no longer exists.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const rawId = req.cookies?.kno_user_id;
  const userId = parseInt(rawId, 10);

  if (!rawId || isNaN(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await User.findByPk(userId);
  if (!user) {
    res.clearCookie('kno_user_id');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = user;
  next();
}

/**
 * requireDebugSecret — locks debug/admin endpoints behind the DEBUG_SECRET env var.
 * Send the header:  X-Debug-Secret: <value>
 */
export function requireDebugSecret(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.DEBUG_SECRET;
  if (!secret) {
    // No secret configured → block in production, allow in dev
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Debug endpoints disabled in production' });
    }
    return next();
  }
  if (req.headers['x-debug-secret'] !== secret) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
