import User from '../models/user.js';
import Event from '../models/event.js';
import UserEventRecommendation from '../models/userEventRecommendation.js';
import calendarService from './calendarService.js';
import emailService from './emailService.js';
import { InterestMatrix, TagWeights, UserPreferencesV2, UserResponse } from '../types/index.js';
import { Op } from 'sequelize';

// ─── Distance (Haversine) ─────────────────────────────────────────────────────

function calculateDistanceMiles(coords1: number[], coords2: number[]): number {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Budget tier helpers ──────────────────────────────────────────────────────

const BUDGET_MAX_PRICE: Record<string, number> = {
  free: 0,
  budget: 15,
  moderate: 50,
  splurge: Infinity,
};

// ─── Interest matrix helpers ──────────────────────────────────────────────────

function defaultMatrix(): InterestMatrix {
  return { tag_weights: {}, venue_history: {}, last_updated: new Date().toISOString() };
}

function applyTagWeightUpdates(
  matrix: InterestMatrix,
  tags: string[],
  delta: number
): InterestMatrix {
  const weights = { ...matrix.tag_weights };
  for (const tag of tags) {
    const current = weights[tag] ?? 1.0;
    weights[tag] = Math.min(2.0, Math.max(0.3, current + delta));
  }
  return { ...matrix, tag_weights: weights, last_updated: new Date().toISOString() };
}

// Denver is UTC-6 (MDT, Mar–Nov) / UTC-7 (MST, Nov–Mar).
// We use a fixed offset for converting local Denver times to UTC.
const DENVER_UTC_OFFSET_HOURS = (() => {
  // Determine MST vs MDT based on current date
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = now.getTimezoneOffset() < stdOffset;
  // Server is UTC so we manually track Denver offset
  // MDT = UTC-6 (offset to add to local time to get UTC)
  // MST = UTC-7
  const month = now.getMonth() + 1; // 1-12
  // DST: second Sunday in March through first Sunday in November
  const inDST = month > 3 || (month === 3 && now.getDate() >= 8) || month < 11;
  return inDST ? 6 : 7;
})();

// Denver city center fallback coordinates
const DENVER_CENTER_COORDS: [number, number] = [-104.9847, 39.7392];

// ─── Recommendation Engine ────────────────────────────────────────────────────

class RecommendationEngine {

  // ─── Main entry point ─────────────────────────────────────────────────────

  /**
   * Called by the hourly cron tick.
   * Dispatches only users whose schedule matches the current day.
   * All frequencies use a once-per-UTC-day guard — no hour targeting.
   */
  async runForEligibleUsers(): Promise<void> {
    const now = new Date();
    const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const todayName = DAY_NAMES[now.getUTCDay()];
    const denverHour = (now.getUTCHours() - DENVER_UTC_OFFSET_HOURS + 24) % 24;

    console.log(`[RecommendationEngine] Tick — Denver ${denverHour}:00, day=${todayName}`);

    // Only deliver at/after noon Denver time
    if (denverHour < 12) {
      console.log('[RecommendationEngine] Before noon Denver — skipping');
      return;
    }

    const users = await User.findAll({ where: { onboarding_complete: true } });

    for (const user of users) {
      try {
        const { shouldRun, targetDays } = this.getDeliveryInfo(user, todayName);
        if (!shouldRun) continue;
        console.log(`[RecommendationEngine] Running for user ${user.id} — targeting days: ${targetDays.join(', ')}`);
        await this.runForUser(user, targetDays);
      } catch (err) {
        console.error(`[RecommendationEngine] Error for user ${user.id}:`, err);
      }
    }
  }

  private async userAlreadyRanToday(userId: number): Promise<boolean> {
    // Use Denver local midnight as the day boundary, not UTC midnight.
    // UTC midnight = 6pm Denver (MDT) which would reset the guard mid-evening.
    const startOfDenverDay = new Date();
    startOfDenverDay.setUTCHours(DENVER_UTC_OFFSET_HOURS, 0, 0, 0); // midnight Denver = 06:00 UTC (MDT)
    // If we're before Denver midnight (i.e., UTC hour < offset), roll back a day
    if (new Date().getUTCHours() < DENVER_UTC_OFFSET_HOURS) {
      startOfDenverDay.setUTCDate(startOfDenverDay.getUTCDate() - 1);
    }
    const count = await UserEventRecommendation.count({
      where: { user_id: userId, proposed_at: { [Op.gte]: startOfDenverDay } },
    });
    return count > 0;
  }

  /** Returns how many proposals have been created for a user in the last 7 days. */
  private async proposalsThisWeek(userId: number): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return UserEventRecommendation.count({
      where: { user_id: userId, proposed_at: { [Op.gte]: sevenDaysAgo } },
    });
  }

  /**
   * Full recommendation run for a single user:
   * 1. Check Google Calendar availability
   * 2. Run 7-step matching pipeline
   * 3. Create Google Calendar proposals
   * 4. Record in DB
   */
  async runForUser(user: User, targetDays: string[] = []): Promise<void> {
    if (!user.google_access_token) {
      console.warn(`User ${user.id} has no Google access token — skipping`);
      return;
    }

    // 1. Get calendar availability
    const busyWindows = await calendarService.getBusyWindows(user);
    const allOpenWindows = calendarService.getOpenWindows(busyWindows, user);

    // Filter windows to only target days (unless this is a replacement run)
    const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDaySet = new Set(targetDays);
    const openWindows = targetDays.length > 0
      ? allOpenWindows.filter(w => targetDaySet.has(DAY_NAMES[w.start.getUTCDay()]))
      : allOpenWindows;

    if (openWindows.length === 0) {
      console.log(`User ${user.id}: no open windows on target days (${targetDays.join(', ')})`);
      return;
    }

    // Check if user has a pending needs_replacement request (from a passed proposal with a hint)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const replacementNeeded = await UserEventRecommendation.findOne({
      where: {
        user_id: user.id,
        needs_replacement: true,
        user_response: 'deleted',
        response_detected_at: { [Op.gte]: twentyFourHoursAgo },
      },
      order: [['response_detected_at', 'DESC']],
    });

    // Weekly budget = number of selected days, capped at 5
    const availableDays = user.recommendation_days ?? [];
    const weeklyLimit = availableDays.length || 1;
    const alreadySentThisWeek = await this.proposalsThisWeek(user.id);
    const remainingThisWeek = weeklyLimit - alreadySentThisWeek;

    if (remainingThisWeek <= 0 && !replacementNeeded) {
      console.log(`User ${user.id}: weekly proposal limit (${weeklyLimit}) reached — skipping`);
      return;
    }

    // Guard: already ran today (bypass for replacement runs)
    const alreadyRanToday = await this.userAlreadyRanToday(user.id);
    if (alreadyRanToday && !replacementNeeded) {
      console.log(`User ${user.id}: already ran today and no replacement needed — skipping`);
      return;
    }

    // One proposal per target day, capped at remaining weekly budget
    const proposalsThisRun = replacementNeeded ? 1 : Math.min(targetDays.length || 1, remainingThisWeek);

    // Pass the re_search_hint (if any) to the scoring pipeline
    const reSearchHint = replacementNeeded?.re_search_hint ?? null;
    if (reSearchHint) {
      console.log(`User ${user.id}: replacement run — hint: "${reSearchHint}"`);
      // Clear the flag so it doesn't keep triggering
      await replacementNeeded!.update({ needs_replacement: false });
    }
    const proposals: { event: Event; score: number }[] = [];

    // Find calendar days that already have a pending kno proposal — don't double-book a day
    const pendingProposals = await UserEventRecommendation.findAll({
      where: { user_id: user.id, user_response: 'pending' },
      include: [{ model: Event, attributes: ['datetime'] }],
    });
    const daysAlreadyBooked = new Set<string>(
      pendingProposals
        .map(p => (p as any).Event?.datetime?.start)
        .filter(Boolean)
        .map((start: string | Date) => new Date(start).toISOString().slice(0, 10))
    );

    for (const window of openWindows) {
      if (proposals.length >= proposalsThisRun) break;
      const windowDay = window.start.toISOString().slice(0, 10);
      if (daysAlreadyBooked.has(windowDay)) {
        console.log(`User ${user.id}: ${windowDay} already has a pending proposal — skipping window`);
        continue;
      }
      const candidates = await this.getCandidatesForWindow(user, window, proposals.map(p => p.event.id), reSearchHint);
      proposals.push(...candidates.slice(0, proposalsThisRun - proposals.length));
    }

    if (proposals.length === 0) {
      console.log(`User ${user.id}: no matching events found`);
      return;
    }

    // 3. Create calendar proposals & record
    for (const { event, score } of proposals) {
      const gcalId = await calendarService.createProposal(user, event);
      if (!gcalId) {
        // Calendar creation failed — do NOT record in DB so the engine retries next hour
        console.error(`User ${user.id}: createProposal returned null for "${event.title}" — skipping DB write so we can retry`);
        continue;
      }
      await UserEventRecommendation.create({
        user_id: user.id,
        event_id: event.id,
        sent_at: new Date(),
        proposed_at: new Date(),
        google_calendar_event_id: gcalId,
        user_response: 'pending',
        proposal_score: score,
      });

      // Track times_proposed in venue_history
      const venueName: string | null = (event as any).venue_name ?? null;
      if (venueName) {
        const matrix = (user.interest_matrix as InterestMatrix) ?? defaultMatrix();
        const history = matrix.venue_history ?? {};
        const entry = history[venueName] ?? { times_proposed: 0, times_kept: 0 };
        history[venueName] = { ...entry, times_proposed: entry.times_proposed + 1 };
        await user.update({ interest_matrix: { ...matrix, venue_history: history } });
      }

      console.log(`User ${user.id}: proposed "${event.title}" (score ${score.toFixed(2)}, gcal: ${gcalId})`);
    }
  }

  // ─── 7-step matching pipeline ─────────────────────────────────────────────

  private async getCandidatesForWindow(
    user: User,
    window: { start: Date; end: Date; isWeekend: boolean },
    alreadyProposedIds: number[],
    reSearchHint: string | null = null
  ): Promise<{ event: Event; score: number }[]> {

    const prefs = (user.preferences as UserPreferencesV2) ?? {};
    const matrix = (user.interest_matrix as InterestMatrix) ?? defaultMatrix();
    const maxDistanceMiles = prefs.max_distance_miles ?? 5;
    const budget = prefs.budget ?? 'moderate';
    const maxPrice = BUDGET_MAX_PRICE[budget] ?? 50;

    // Reference location: work on weekdays, home on weekends; fall back to Denver center
    const rawRef = window.isWeekend
      ? (user.home_location ?? user.work_location)
      : (user.work_location ?? user.home_location);

    const refLocation = rawRef?.coordinates
      ? rawRef
      : { coordinates: DENVER_CENTER_COORDS };

    if (!rawRef?.coordinates) {
      console.warn(`User ${user.id}: no location set — using Denver center as fallback`);
    }

    // Step 1: Time filter — events that start within the open window
    const windowBufferMs = 30 * 60 * 1000;
    const windowStart = new Date(window.start.getTime() - windowBufferMs);
    const windowEnd = new Date(window.end.getTime() + windowBufferMs);

    // Step 5: Already-proposed filter — skip events proposed to this user in last 60 days
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const recentlyProposed = await UserEventRecommendation.findAll({
      where: {
        user_id: user.id,
        proposed_at: { [Op.gte]: sixtyDaysAgo },
      },
      attributes: ['event_id', 'proposed_at'],
      include: [{ model: Event, attributes: ['venue_name'] }],
    });
    const excludedIds = [
      ...recentlyProposed.map(r => r.event_id),
      ...alreadyProposedIds,
    ];

    // Build venue → most recent proposal date map for freshness decay
    const venueLastProposed = new Map<string, Date>();
    for (const rec of recentlyProposed) {
      const venueName = (rec as any).Event?.venue_name;
      if (!venueName || !rec.proposed_at) continue;
      const existing = venueLastProposed.get(venueName);
      const proposedAt = new Date(rec.proposed_at);
      if (!existing || proposedAt > existing) venueLastProposed.set(venueName, proposedAt);
    }

    // Step 4: Category match
    const preferredTypes = prefs.event_types ?? [];

    const where: Record<string, any> = {
      is_active: true,
      city: user.city ?? 'denver',
    };

    if (excludedIds.length > 0) {
      where.id = { [Op.notIn]: excludedIds };
    }

    if (preferredTypes.length > 0) {
      // Map preference keywords to EventType values
      const typeMap: Record<string, string[]> = {
        happy_hour: ['bar'],
        concert: ['concert'],
        trivia: ['trivia'],
        comedy: ['comedy'],
        art: ['art'],
        market: ['market'],
        festival: ['festival'],
        outdoor: ['park', 'social'],
        film: ['film'],
        class: ['class'],
        running: ['park', 'sports'],
        hiking: ['park', 'sports'],
        cycling: ['park', 'sports'],
        climbing: ['park', 'sports'],
        yoga: ['class', 'park'],
        gardening: ['park'],
        nature_walks: ['park'],
      };
      const eventTypes = [...new Set(
        preferredTypes.flatMap(t => typeMap[t] ?? [t])
      )];
      if (eventTypes.length > 0) {
        where.type = { [Op.in]: eventTypes };
      }
    }

    // Fetch recurring events + one-time events whose time falls in the window
    const currentDayOfWeek = window.start.getDay();

    const allEvents = await Event.findAll({ where });

    // Steps 1–4 + 5 applied programmatically
    const filtered = allEvents.filter(event => {
      const loc = event.location as any;
      const coords = loc?.coordinates;

      // Skip invalid coordinates
      if (!coords || (coords[0] === 0 && coords[1] === 0)) return false;

      // Step 2: Distance filter
      const distanceMiles = calculateDistanceMiles(refLocation.coordinates, coords);
      if (distanceMiles > maxDistanceMiles) return false;

      // Step 3: Budget filter
      const eventMaxPrice = (event.price as any)?.max;
      if (eventMaxPrice !== undefined && eventMaxPrice !== null && eventMaxPrice > maxPrice) return false;

      // Step 1 (time): recurring events match if today is a valid day
      if (event.recurring) {
        const recurrence = event.recurrence_pattern as any;
        const happyHourSched = event.happy_hour_schedule as any;

        // Check day-of-week
        const validDays: number[] = recurrence?.dayOfWeek ?? [];
        if (!validDays.includes(currentDayOfWeek)) return false;

        // Check time falls within open window.
        // happy_hour_schedule times are Denver local — convert to UTC before comparing.
        const localStartHour = happyHourSched?.start
          ? parseInt(happyHourSched.start.split(':')[0], 10)
          : (event.datetime as any)?.start
          ? new Date((event.datetime as any).start).getUTCHours()
          : 17; // default 5pm local

        const startHourUtc = (localStartHour + DENVER_UTC_OFFSET_HOURS) % 24;

        const eventStartTime = new Date(window.start);
        eventStartTime.setUTCHours(startHourUtc, 0, 0, 0);
        // If UTC conversion wrapped to next day, advance by one day
        if (startHourUtc < 6 && localStartHour >= 12) {
          eventStartTime.setUTCDate(eventStartTime.getUTCDate() + 1);
        }

        if (eventStartTime < windowStart || eventStartTime > windowEnd) return false;
      } else {
        // One-time event — check actual start time
        const eventStart = new Date((event.datetime as any)?.start);
        if (isNaN(eventStart.getTime())) return false;
        if (eventStart < windowStart || eventStart > windowEnd) return false;
      }

      return true;
    });

    // Step 6: Score candidates
    const scored = filtered.map(event => {
      const loc = event.location as any;
      const distanceMiles = calculateDistanceMiles(refLocation.coordinates, loc.coordinates);
      const tags: string[] = (event.tags as any) ?? [];

      // Base score: tag overlap with user preferences
      const allPrefTags = [
        ...(prefs.event_types ?? []),
        ...(prefs.drink ?? []),
        ...(prefs.vibe ?? []),
        ...(prefs.food ?? []),
      ];
      const overlap = tags.filter(t => allPrefTags.includes(t)).length;
      let score = overlap;

      // Apply interest matrix weights
      for (const tag of tags) {
        const weight = matrix.tag_weights[tag] ?? 1.0;
        score += (weight - 1.0) * 0.5;
      }

      // Boost: activity level match
      const activityLevel = prefs.activity_level ?? 'medium';
      const ACTIVITY_TAGS: Record<string, string[]> = {
        low:    ['chill', 'bar', 'happy_hour', 'wine', 'comedy', 'film'],
        medium: ['social', 'trivia', 'concert', 'art', 'market'],
        high:   ['outdoor', 'active', 'hiking', 'festival', 'sports'],
      };
      if (tags.some(t => (ACTIVITY_TAGS[activityLevel] ?? []).includes(t))) score += 0.25;

      // Boost/decay: indoor/outdoor preference
      const indoorOutdoor = prefs.indoor_outdoor ?? 'no_preference';
      if (indoorOutdoor !== 'no_preference') {
        if (tags.includes(indoorOutdoor)) score += 0.2;
        const opposite = indoorOutdoor === 'indoor' ? 'outdoor' : 'indoor';
        if (tags.includes(opposite)) score -= 0.15;
      }

      // Boost: dietary tag match
      const dietary = prefs.dietary ?? [];
      if (dietary.length > 0) {
        score += tags.filter(t => dietary.includes(t)).length * 0.2;
      }

      // Boost: free events for budget-conscious users
      const eventMaxPrice = (event.price as any)?.max ?? 0;
      if (eventMaxPrice === 0 && (budget === 'free' || budget === 'budget')) {
        score += 0.3;
      }

      // Boost: walkable (within 1 mile)
      if (distanceMiles <= 1) score += 0.2;

      // Boost/decay: venue history — reward proven venues, penalize repeatedly-ignored ones
      const venueName: string | null = (event as any).venue_name ?? null;
      if (venueName && matrix.venue_history) {
        const history = matrix.venue_history[venueName];
        if (history) {
          if (history.times_kept > 0) score += 0.3;
          if (history.times_proposed >= 3 && history.times_kept === 0) score -= 0.2;
        }
      }

      // Boost: manually curated events (Google Sheets) are hand-picked — trust them
      if ((event as any).source === 'google_sheets') score += 0.25;

      // Decay: venue freshness — don't keep proposing the same venue repeatedly
      if (venueName) {
        const lastProposed = venueLastProposed.get(venueName);
        if (lastProposed) {
          const daysSince = (Date.now() - lastProposed.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < 7) score -= 0.5;
          else if (daysSince < 21) score -= 0.3;
        }
      }

      // Boost: custom interest keyword matching
      const customInterests: string[] = (prefs as any).custom_interests ?? [];
      if (customInterests.length > 0) {
        const eventText = `${event.title} ${event.description ?? ''} ${(event as any).venue_name ?? ''}`.toLowerCase();
        for (const interest of customInterests) {
          const keywords = interest.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
          if (keywords.some(k => eventText.includes(k))) score += 0.3;
        }
      }

      // Boost: re-search hint keyword matching (replacement run)
      if (reSearchHint) {
        const eventText = `${event.title} ${event.description ?? ''} ${tags.join(' ')}`.toLowerCase();
        const hintKeywords = reSearchHint.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2);
        if (hintKeywords.some(k => eventText.includes(k))) score += 0.5;
      }

      // Decay: alcohol-centric events score lower Mon–Wed
      // Still eligible, just deprioritised vs. non-bar alternatives
      const ALCOHOL_TAGS = ['happy_hour', 'bar', 'craft_beer', 'cocktails', 'wine'];
      const dayOfWeek = window.start.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
      const isEarlyWeek = dayOfWeek >= 1 && dayOfWeek <= 3; // Mon, Tue, Wed
      if (isEarlyWeek && (ALCOHOL_TAGS.some(t => tags.includes(t)) || event.type === 'bar')) {
        score -= 0.5;
      }

      return { event, score };
    });

    // Step 7: Pick top N — deduplicate by venue
    scored.sort((a, b) => b.score - a.score);

    const seenVenues = new Set<string>();
    const results: { event: Event; score: number }[] = [];

    for (const candidate of scored) {
      const venueName = (candidate.event as any).venue_name ?? candidate.event.title;
      if (seenVenues.has(venueName)) continue;
      seenVenues.add(venueName);
      results.push(candidate);
      if (results.length >= Math.min((user.recommendation_days ?? []).length || 1, 5)) break;
    }

    return results;
  }

  // ─── Diagnostics ─────────────────────────────────────────────────────────────

  /**
   * Dry-run the full pipeline for a user and return a JSON breakdown of
   * what happened at each step. No DB writes, no calendar events created.
   */
  async explainForUser(user: User): Promise<Record<string, any>> {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const now = new Date();
    const todayName = dayNames[now.getUTCDay()];

    const { shouldRun: scheduleMatch, targetDays } = this.getDeliveryInfo(user, todayName);
    const alreadyRan = await this.userAlreadyRanToday(user.id);
    const alreadySentThisWeek = await this.proposalsThisWeek(user.id);
    const availableDays = user.recommendation_days ?? [];
    const weeklyLimit = availableDays.length || 1;

    if (!user.google_access_token) {
      return { blocked: 'no_google_token', user_id: user.id };
    }

    const busyWindows = await calendarService.getBusyWindows(user);
    const openWindows = calendarService.getOpenWindows(busyWindows, user);

    const windowDetails = await Promise.all(
      openWindows.slice(0, 5).map(async w => {
        const candidates = await this.getCandidatesForWindow(user, w, []);
        return {
          window_start: w.start,
          window_end: w.end,
          is_weekend: w.isWeekend,
          candidates_found: candidates.length,
          top_candidates: candidates.slice(0, 3).map(c => ({
            id: c.event.id,
            title: c.event.title,
            type: c.event.type,
            score: parseFloat(c.score.toFixed(3)),
            event_start: (c.event.datetime as any)?.start,
          })),
        };
      })
    );

    return {
      user_id: user.id,
      now_utc: now.toISOString(),
      today_name: todayName,
      schedule_match: scheduleMatch,
      target_days: targetDays,
      delivery_timing: user.delivery_timing ?? 'day_of',
      already_ran_today: alreadyRan,
      proposals_this_week: alreadySentThisWeek,
      weekly_limit: weeklyLimit,
      remaining_this_week: weeklyLimit - alreadySentThisWeek,
      busy_windows_count: busyWindows.length,
      open_windows_count: openWindows.length,
      recommendation_days: user.recommendation_days,
      home_location: user.home_location,
      work_location: user.work_location,
      preferences_summary: {
        event_types: (user.preferences as any)?.event_types,
        max_distance_miles: (user.preferences as any)?.max_distance_miles,
        budget: (user.preferences as any)?.budget,
      },
      windows: windowDetails,
    };
  }

  // ─── Legacy: generate and send via email (kept for backward compat) ────────

  async generateAndSendRecommendations(): Promise<void> {
    try {
      const users = await User.findAll();
      for (const user of users) {
        try {
          const recommendations = await this.getRecommendationsForUser(user);
          if (recommendations.length > 0) {
            await emailService.sendRecommendations(user.email, recommendations);
            await this.recordSentRecommendations(user.id, recommendations);
          }
        } catch (err) {
          console.error(`Error for user ${user.id}:`, err);
        }
      }
    } catch (error) {
      console.error('Error generating recommendations:', error);
    }
  }

  /** Legacy email-based recommendations (uses old preference schema) */
  async getRecommendationsForUser(user: User): Promise<Event[]> {
    const now = new Date();
    const currentDayOfWeek = now.getDay();

    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 7);

    const recentlyRecommendedEventIds = await UserEventRecommendation.findAll({
      where: { user_id: user.id, sent_at: { [Op.gte]: sixtyDaysAgo } },
      attributes: ['event_id'],
    }).then(recs => recs.map(r => r.event_id));

    const where: Record<string, any> = {
      is_active: true,
    };

    if (recentlyRecommendedEventIds.length > 0) {
      where.id = { [Op.notIn]: recentlyRecommendedEventIds };
    }

    const events = await Event.findAll({ where });

    const prefs = user.preferences as any;
    const maxDistance = prefs?.maxDistance ?? prefs?.max_distance_miles ?? 10;
    const userCoords =
      (user.home_location as any)?.coordinates ??
      (user.location as any)?.coordinates ??
      null;

    if (!userCoords) return [];

    const maxBudget = prefs?.priceRange?.max ?? BUDGET_MAX_PRICE[prefs?.budget ?? 'moderate'];

    const valid = events.filter(event => {
      const coords = (event.location as any)?.coordinates;
      if (!coords || (coords[0] === 0 && coords[1] === 0)) return false;

      const distance = calculateDistanceMiles(userCoords, coords);
      if (distance > maxDistance) return false;

      if ((event.price as any)?.max && (event.price as any).max > maxBudget) return false;

      if (event.recurring) {
        return (event.recurrence_pattern as any)?.dayOfWeek?.includes(currentDayOfWeek) ?? false;
      }

      return true;
    });

    valid.sort((a, b) => {
      const da = calculateDistanceMiles(userCoords, (a.location as any).coordinates);
      const db = calculateDistanceMiles(userCoords, (b.location as any).coordinates);
      return da - db;
    });

    return valid.slice(0, 3);
  }

  async recordSentRecommendations(userId: number, events: Event[]): Promise<void> {
    await UserEventRecommendation.bulkCreate(
      events.map(event => ({ user_id: userId, event_id: event.id, sent_at: new Date() }))
    );
  }

  // ─── Feedback loop ────────────────────────────────────────────────────────

  /**
   * Polls Google Calendar for each pending proposal.
   * Updates user_response and adjusts interest_matrix accordingly.
   * Runs every 6 hours.
   */
  async pollCalendarFeedback(): Promise<void> {
    const pendingRecs = await UserEventRecommendation.findAll({
      where: {
        user_response: 'pending',
        google_calendar_event_id: { [Op.ne]: null },
        proposed_at: { [Op.ne]: null },
      },
      include: [
        { model: User },
        { model: Event },
      ],
    });

    console.log(`[FeedbackLoop] Checking ${pendingRecs.length} pending proposals`);

    for (const rec of pendingRecs) {
      try {
        const user = (rec as any).User as User;
        const event = (rec as any).Event as Event;

        if (!user?.google_access_token || !rec.google_calendar_event_id) continue;

        const status = await calendarService.checkProposalStatus(user, rec.google_calendar_event_id);

        if (status === 'pending') continue; // nothing changed

        await rec.update({
          user_response: status,
          response_detected_at: new Date(),
        });

        // Update interest matrix
        if (event?.tags) {
          await this.updateInterestMatrix(
            user,
            event.tags as string[],
            status,
            (event as any).venue_name ?? null
          );
        }

        console.log(`[FeedbackLoop] User ${user.id}: "${event?.title}" → ${status}`);
      } catch (err) {
        console.error(`[FeedbackLoop] Error processing rec ${rec.id}:`, err);
      }
    }
  }

  private async updateInterestMatrix(
    user: User,
    tags: string[],
    response: 'kept' | 'deleted',
    venueName?: string | null
  ): Promise<void> {
    const matrix = (user.interest_matrix as InterestMatrix) ?? defaultMatrix();
    const delta = response === 'kept' ? 0.2 : -0.1;
    let updated = applyTagWeightUpdates(matrix, tags, delta);

    // Update venue_history
    if (venueName) {
      const history = updated.venue_history ?? {};
      const entry = history[venueName] ?? { times_proposed: 0, times_kept: 0 };
      history[venueName] = {
        times_proposed: entry.times_proposed,
        times_kept: response === 'kept' ? entry.times_kept + 1 : entry.times_kept,
      };
      updated = { ...updated, venue_history: history };
    }

    await user.update({ interest_matrix: updated });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  async getUniqueUserLocations(): Promise<number[][]> {
    const users = await User.findAll({ attributes: ['home_location', 'location'] });
    return users
      .map(u => (u.home_location as any)?.coordinates ?? (u.location as any)?.coordinates)
      .filter(Boolean);
  }

  /**
   * Determines whether a user's schedule matches today.
   * No hour-of-day targeting — proposals fire on the first cron tick of the day
   * that matches the user's day list and frequency. The once-per-day guard in
   * runForEligibleUsers prevents duplicates.
   */
  private getDeliveryInfo(user: User, todayName: string): { shouldRun: boolean; targetDays: string[] } {
    const availableDays = user.recommendation_days ?? [];
    const delivery = user.delivery_timing ?? 'day_of';
    const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const WEEKEND = ['saturday', 'sunday'];

    if (delivery === 'day_of') {
      // Fire on each selected day — today must be a selected day
      const shouldRun = availableDays.length === 0 || availableDays.includes(todayName);
      return { shouldRun, targetDays: shouldRun ? [todayName] : [] };
    }

    if (delivery === 'sunday') {
      // Deliver all week's picks on Sunday
      if (todayName !== 'sunday') return { shouldRun: false, targetDays: [] };
      return { shouldRun: true, targetDays: availableDays.length > 0 ? availableDays : ['monday', 'wednesday', 'friday'] };
    }

    if (delivery === 'smart') {
      const targetDays: string[] = [];
      // Weekday: deliver day-of if today is a selected weekday
      if (WEEKDAYS.includes(todayName) && (availableDays.length === 0 || availableDays.includes(todayName))) {
        targetDays.push(todayName);
      }
      // Wednesday: also queue upcoming weekend days that user selected
      if (todayName === 'wednesday') {
        targetDays.push(...WEEKEND.filter(d => availableDays.includes(d)));
      }
      return { shouldRun: targetDays.length > 0, targetDays };
    }

    return { shouldRun: false, targetDays: [] };
  }
}

export default new RecommendationEngine();
