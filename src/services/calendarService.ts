import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import crypto from 'crypto';
import User from '../models/user.js';
import Event from '../models/event.js';
import { getCityUTCOffset } from '../utils/timezone.js';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
  'profile',
];

// ─── Token encryption helpers ─────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY env var is required');
  return crypto.createHash('sha256').update(key).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, authTagHex, encHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── OAuth2 client factory ────────────────────────────────────────────────────

export function createOAuth2Client(): OAuth2Client {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${APP_URL}/auth/google/callback`;
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
}

// ─── Calendar Service ─────────────────────────────────────────────────────────

export class CalendarService {

  /** Returns the URL the user should visit to authorize kno */
  getAuthUrl(state?: string): string {
    const client = createOAuth2Client();
    return client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      state: state ?? '',
    });
  }

  /**
   * Exchanges the code returned by Google for access + refresh tokens.
   * Stores encrypted tokens on the user record and returns the updated user.
   */
  async handleCallback(code: string): Promise<{
    user: User;
    isNew: boolean;
  }> {
    const client = createOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Fetch basic profile
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) throw new Error('No email returned from Google OAuth');

    const encAccess = tokens.access_token ? encryptToken(tokens.access_token) : undefined;
    const encRefresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : undefined;

    const [user, isNew] = await User.findOrCreate({
      where: { email: profile.email },
      defaults: {
        email: profile.email,
        name: profile.name ?? undefined,
        google_id: profile.id ?? undefined,
        google_access_token: encAccess,
        google_refresh_token: encRefresh,
        google_calendar_id: 'primary',
        city: 'denver',
        onboarding_complete: false,
        preferences: {},
      },
    });

    if (!isNew) {
      const updates: Partial<User> = {
        google_id: profile.id ?? user.google_id,
        google_access_token: encAccess ?? user.google_access_token,
      };
      if (encRefresh) updates.google_refresh_token = encRefresh;
      if (profile.name) updates.name = profile.name;
      await user.update(updates);
    }

    return { user, isNew };
  }

  /** Returns an authenticated OAuth2 client for a given user. */
  private async getClientForUser(user: User): Promise<OAuth2Client> {
    if (!user.google_access_token) throw new Error(`User ${user.id} has no access token`);
    const client = createOAuth2Client();
    client.setCredentials({
      access_token: decryptToken(user.google_access_token),
      refresh_token: user.google_refresh_token ? decryptToken(user.google_refresh_token) : undefined,
    });
    // Auto-refresh on expiry
    client.on('tokens', async (newTokens) => {
      if (newTokens.access_token) {
        await user.update({ google_access_token: encryptToken(newTokens.access_token) });
      }
    });
    return client;
  }

  // ─── Availability ────────────────────────────────────────────────────────────

  /**
   * Returns an array of "busy" time windows for the user over the next 14 days.
   * Each window is { start: Date, end: Date }.
   */
  async getBusyWindows(user: User): Promise<{ start: Date; end: Date }[]> {
    const client = await this.getClientForUser(user);
    const cal = google.calendar({ version: 'v3', auth: client });

    const now = new Date();
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const resp = await cal.events.list({
      calendarId: user.google_calendar_id ?? 'primary',
      timeMin: now.toISOString(),
      timeMax: twoWeeks.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });

    const items = resp.data.items ?? [];
    const busyWindows: { start: Date; end: Date }[] = [];

    for (const ev of items) {
      if (ev.status === 'cancelled') continue;
      const start = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
      const end = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
      if (!start || !end) continue;

      // 1hr buffer before/after existing events
      busyWindows.push({
        start: new Date(start.getTime() - 60 * 60 * 1000),
        end: new Date(end.getTime() + 60 * 60 * 1000),
      });
    }

    return busyWindows;
  }

  /**
   * Identifies open windows that:
   * - Fall on one of the user's preferred days
   * - Are at least 2hrs long (weekday evenings) or 3hrs (weekends)
   * - Are after 4pm on weekdays / any time on weekends
   */
  getOpenWindows(
    busyWindows: { start: Date; end: Date }[],
    user: User,
    daysAhead = 14
  ): { start: Date; end: Date; isWeekend: boolean }[] {
    const preferredDays = user.recommendation_days ?? [];
    const preferredDaySet = new Set(
      preferredDays.length > 0
        ? preferredDays.map(d => d.toLowerCase())
        : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    );

    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const openWindows: { start: Date; end: Date; isWeekend: boolean }[] = [];

    const now = new Date();
    const utcOffset = getCityUTCOffset(user.city ?? 'denver', now);

    // Base the loop off the city-local date so evening runs (after 6pm Denver
    // = after midnight UTC) still compute the correct local day names.
    const cityLocalNow = new Date(now.getTime() - utcOffset * 3_600_000);
    for (let i = 0; i < daysAhead; i++) {
      const day = new Date(cityLocalNow);
      day.setUTCDate(cityLocalNow.getUTCDate() + i);
      const dayName = dayNames[day.getUTCDay()];

      if (!preferredDaySet.has(dayName)) continue;

      const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;

      // Window times in Denver local, converted to UTC by adding utcOffset.
      // Weekday: 4pm–11pm Denver = 22:00–05:00 UTC (next day)
      // Weekend: 11am–11pm Denver = 17:00–05:00 UTC (next day)
      const localStartHour = isWeekend ? 11 : 16;
      const localEndHour = 23; // 11pm Denver

      const windowStart = new Date(day);
      windowStart.setUTCHours(localStartHour + utcOffset, 0, 0, 0);

      const windowEnd = new Date(day);
      const endUtcHour = localEndHour + utcOffset;
      if (endUtcHour >= 24) {
        windowEnd.setUTCDate(windowEnd.getUTCDate() + 1);
        windowEnd.setUTCHours(endUtcHour - 24, 0, 0, 0);
      } else {
        windowEnd.setUTCHours(endUtcHour, 0, 0, 0);
      }

      // Check if this window is free
      const isBusy = busyWindows.some(
        bw => bw.start < windowEnd && bw.end > windowStart
      );

      const minHours = isWeekend ? 3 : 2;
      const windowDurationHours = (windowEnd.getTime() - windowStart.getTime()) / 3600000;

      if (!isBusy && windowDurationHours >= minHours) {
        openWindows.push({ start: windowStart, end: windowEnd, isWeekend });
      }
    }

    return openWindows;
  }

  // ─── Proposal creation ───────────────────────────────────────────────────────

  /**
   * Creates a Google Calendar event for the given kno event suggestion.
   * Returns the Google Calendar event ID.
   */
  async createProposal(user: User, event: Event): Promise<string | null> {
    try {
      const client = await this.getClientForUser(user);
      const cal = google.calendar({ version: 'v3', auth: client });

      const address = (event.location as any)?.address ?? '';
      const priceStr = event.price
        ? event.price.min === 0 && event.price.max === 0
          ? 'Free'
          : `$${event.price.min}–$${event.price.max}`
        : '';

      const description = [
        event.description ?? '',
        '',
        priceStr ? `💰 ${priceStr}` : '',
        address ? `📍 ${address}` : '',
        '',
        'Suggested by kno based on your preferences.',
        'Not interested? Delete this event.',
      ]
        .filter(l => l !== null)
        .join('\n')
        .trim();

      const gcalEvent: calendar_v3.Schema$Event = {
        summary: `🎉 [kno] ${event.title}`,
        description,
        start: {
          dateTime: (event.datetime as any).start instanceof Date
            ? (event.datetime as any).start.toISOString()
            : new Date((event.datetime as any).start).toISOString(),
        },
        end: {
          dateTime: (event.datetime as any).end instanceof Date
            ? (event.datetime as any).end.toISOString()
            : new Date((event.datetime as any).end).toISOString(),
        },
        location: address || undefined,
        colorId: '11', // Tomato
        extendedProperties: {
          private: {
            kno_proposal: 'true',
            kno_event_id: String(event.id),
          },
        },
      };

      const resp = await cal.events.insert({
        calendarId: user.google_calendar_id ?? 'primary',
        requestBody: gcalEvent,
      });

      return resp.data.id ?? null;
    } catch (error) {
      console.error(`Failed to create calendar proposal for user ${user.id}, event ${event.id}:`, error);
      return null;
    }
  }

  // ─── Feedback polling ────────────────────────────────────────────────────────

  /**
   * Checks whether a calendar event still exists.
   * Returns 'kept', 'deleted', or 'pending'.
   */
  async checkProposalStatus(
    user: User,
    googleCalendarEventId: string
  ): Promise<'kept' | 'deleted' | 'pending'> {
    try {
      const client = await this.getClientForUser(user);
      const cal = google.calendar({ version: 'v3', auth: client });

      const resp = await cal.events.get({
        calendarId: user.google_calendar_id ?? 'primary',
        eventId: googleCalendarEventId,
      });

      if (resp.data.status === 'cancelled') return 'deleted';

      const endTime = resp.data.end?.dateTime
        ? new Date(resp.data.end.dateTime)
        : null;

      if (endTime && endTime < new Date()) return 'kept';

      return 'pending';
    } catch (error: any) {
      if (error?.response?.status === 404 || error?.response?.status === 410) {
        return 'deleted';
      }
      console.error(`Error checking proposal status for ${googleCalendarEventId}:`, error);
      return 'pending';
    }
  }
}

export default new CalendarService();
