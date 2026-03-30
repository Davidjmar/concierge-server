# kno — Product & Technical Plan

> *kno* is a serverside-heavy recommendation engine that watches your Google Calendar, knows your tastes, and quietly drops great plans into your week before you have time to do nothing instead.

---

## What kno does (in plain English)

1. You connect your Google Calendar and answer a short questionnaire (takes ~3 minutes).
2. kno scrapes Denver's restaurant happy hours, concerts, park events, bar nights, and other activities from multiple data sources on a rolling basis.
3. On a schedule you choose, kno looks at your upcoming week, finds free windows that match your typical patterns (e.g. after work Tuesday–Thursday, Saturday afternoons), and finds events that fit your tastes, budget, and distance from home or work.
4. kno creates proposed Google Calendar events for the best matches — you just see them appear on your calendar.
5. As you keep or delete those proposals over time, kno learns what you actually like and tunes its suggestions.
6. You never fill out a form again. kno just gets better quietly.

---

## Current state of the repo

The repo (`concierge-server`, now being renamed **kno**) is a Node.js/TypeScript Express server with:

- **Postgres + Sequelize** — `users`, `events`, `user_event_recommendations` tables
- **Scraper stubs** — GoldenBuzz scraper (partially working), Google Sheets feed, Eventbrite/Yelp placeholders
- **Recommendation engine** — skeleton that calls scraper + emails results
- **Email service** — wired up via Resend but not core to the vision
- **Google APIs** — googleapis library installed, credentials.json present
- **Render deployment** — render.yaml configured
- **node-cron** — scheduling infrastructure already in place

What's missing: real event data sources, Google Calendar OAuth & calendar proposal flow, a real user preference model, a proper onboarding UI, and a feedback loop that actually tunes recommendations.

---

## Design Principles

- **Minimal user lift.** Onboarding is one OAuth click + one questionnaire. Nothing else is ever required from the user.
- **Server-heavy.** All intelligence lives on the server. The client (browser) is just a thin display layer.
- **Data quality over quantity.** 50 great, accurate, well-tagged Denver events are worth more than 5,000 stale or mis-tagged ones. We invest heavily in data hygiene.
- **No unnecessary compute.** Rule-based matching (no LLMs in the hot path). Scrapers run on schedules, not on-demand. Calendar checks are batched.
- **Denver-first, city-agnostic architecture.** Everything is namespaced by city from day one so expansion is additive, not a rewrite.

---

## Phase 1 — Data Foundation

*Goal: have a database of real, accurate, well-tagged Denver events and happy hours that updates itself reliably.*

### 1.1 Event model expansion

Add fields to the `events` table (migration 03):

```
city            VARCHAR        -- 'denver' for now; keys all data for multi-city
neighborhood    VARCHAR        -- 'lodo', 'rino', 'highlands', etc.
venue_name      VARCHAR        -- human-readable venue name
tags            TEXT[]         -- e.g. ['happy_hour', 'craft_beer', 'outdoor', 'free']
happy_hour_schedule  JSONB     -- { days: ['mon','tue','wed','thu','fri'], start: '16:00', end: '18:00' }
external_ids    JSONB          -- { eventbrite_id: '...', yelp_id: '...', google_place_id: '...' }
image_url       VARCHAR        -- for web UI display
```

Expand `EventType` enum:
`concert | bar | restaurant | art | sports | social | park | festival | class | comedy | trivia | film | market`

Expand `EventSource` enum:
`eventbrite | yelp | goldenbuzz | westword | google_sheets | denver_gov | manual`

### 1.2 Real Eventbrite API integration

Replace the stub in `scraper.ts` with real Eventbrite Discovery API v3 calls:
- Search Denver events by category, date range, location radius
- Map Eventbrite categories → our `EventType` enum
- Pull price, venue, coordinates, image
- Respect rate limits; cache by `eventbrite_id` to avoid re-inserting

**Env var needed:** `EVENTBRITE_API_KEY`

### 1.3 Real Yelp Fusion API integration

Replace the Yelp stub with real Yelp Fusion API calls:
- Search by category (`bars`, `restaurants`, `food`) + location
- Extract happy hour attributes where available
- For recurring happy hours: store as `recurring: true` with `happy_hour_schedule`
- Geocode and tag by Denver neighborhood

**Env var needed:** `YELP_API_KEY`

### 1.4 Denver Westword scraper

Westword publishes weekly "best things to do" and event listings. New scraper:
- Target: `westword.com/arts/things-to-do-in-denver` and their event calendar
- Use Cheerio (already installed) to parse event cards
- Map to our event schema; tag as `source: 'westword'`
- Run weekly (Westword publishes on Thursdays)

### 1.5 GoldenBuzz scraper — harden and expand

The existing GoldenBuzz scraper needs reliability fixes:
- Add error recovery per neighborhood (one failure doesn't abort the run)
- Expand neighborhood list: `highlands | lodo | rino | lohi | capitol-hill | wash-park | cherry-creek | five-points | baker | sunnyside`
- Detect and skip stale/expired listings

### 1.6 Google Sheets manual curation feed — keep as-is

The existing Google Sheets integration is great for seeding and manually curating edge-case events. Keep it. Add a column for `tags` and `neighborhood` to the sheet schema.

### 1.7 Scrape schedule

```
Yelp happy hours:     Sunday 2 AM  (weekly — happy hours rarely change)
Eventbrite:           Monday 3 AM  (weekly — catches the new week's listings)
Westword:             Friday 6 AM  (catches their Thursday publish)
GoldenBuzz:           Monday 3 AM  (existing schedule, keep it)
Google Sheets:        Every 4 hours (fast feedback loop for manual additions)
Calendar feedback:    Every 6 hours (poll for proposal accept/decline signals)
```

---

## Phase 2 — User Model & Onboarding

*Goal: get a user from zero to fully onboarded in under 3 minutes, with enough data to make good first recommendations.*

### 2.1 User model redesign

Replace the current flat `preferences` JSONB and single `location` with structured fields (migration 04):

**New/updated columns on `users`:**

```
-- Identity
name                    VARCHAR
google_id               VARCHAR UNIQUE   -- from Google OAuth
google_access_token     TEXT             -- encrypted at rest
google_refresh_token    TEXT             -- encrypted at rest
google_calendar_id      VARCHAR          -- default 'primary'

-- Locations
home_location           JSONB            -- { coordinates, address, neighborhood }
work_location           JSONB            -- { coordinates, address, neighborhood }

-- Preferences (structured)
preferences             JSONB            -- see schema below
recommendation_frequency  VARCHAR        -- 'daily' | '2x_week' | 'weekly'
recommendation_days     TEXT[]           -- ['monday','tuesday','friday'] — days to surface suggestions
recommendation_time     VARCHAR          -- 'morning' | 'midday' (when to run the job for this user)
max_proposals_per_run   INTEGER          -- default 3 (don't flood the calendar)
city                    VARCHAR          -- 'denver' for now

-- Feedback / interest matrix
interest_matrix         JSONB            -- auto-updated based on calendar signal
onboarding_complete     BOOLEAN          -- false until questionnaire finished
```

**`preferences` JSONB schema:**
```json
{
  "food": ["pizza", "tacos", "sushi", "burgers", "bbq"],
  "drink": ["craft_beer", "cocktails", "wine", "non_alcoholic"],
  "dietary": ["vegetarian", "vegan", "gluten_free"],
  "event_types": ["concert", "happy_hour", "outdoor", "trivia", "comedy", "art", "market", "festival"],
  "vibe": ["chill", "lively", "social", "date_night", "solo_friendly"],
  "activity_level": "low" | "medium" | "high",
  "indoor_outdoor": "indoor" | "outdoor" | "no_preference",
  "budget": "free" | "budget" | "moderate" | "splurge",
  "max_distance_miles": 5
}
```

**`interest_matrix` JSONB schema** (auto-built from feedback):
```json
{
  "tag_weights": {
    "craft_beer": 1.4,
    "happy_hour": 1.2,
    "outdoor": 0.8,
    "trivia": 1.1
  },
  "venue_history": {
    "venue_name": { "times_proposed": 3, "times_kept": 2 }
  },
  "last_updated": "2025-03-01T12:00:00Z"
}
```

### 2.2 UserEventRecommendation model expansion

Add columns to `user_event_recommendations` (migration 05):

```
google_calendar_event_id   VARCHAR    -- the GCal event we created
proposed_at                DATE       -- when kno created the proposal
user_response              VARCHAR    -- 'kept' | 'deleted' | 'pending'
response_detected_at       DATE       -- when we detected the response
proposal_score             FLOAT      -- the score that got it recommended
```

### 2.3 Simple web onboarding UI

A minimal multi-step wizard served by Express as static HTML/JS at `/`. No React, no build step — just clean vanilla HTML with inline CSS/JS kept in `src/public/`.

**Step 1 — Google Sign-In**
- "Connect your Google account" button
- OAuth2 flow via `googleapis`; we request `calendar.events` + `calendar.readonly` + `profile` scopes
- On success, store `google_id`, `access_token`, `refresh_token` in DB

**Step 2 — Your locations**
- "Where do you live?" — address input with Google Maps Autocomplete
- "Where do you work?" (optional) — same
- Store coordinates + neighborhood lookup

**Step 3 — Your tastes (questionnaire)**
- Section A: Food & Drink — checkbox grid (cuisine types, drink style)
- Section B: Vibes — select cards (chill / lively / social / date-night)
- Section C: Budget — 4-option slider (free → splurge)
- Section D: Activity level — low / medium / high
- Section E: Event types — checkbox grid (concerts, happy hours, outdoor, trivia, art, etc.)
- Section F: Indoor / outdoor preference

**Step 4 — Your schedule**
- "How often should kno suggest things?" — daily / 2x a week / weekly
- "Which days are you usually open?" — day picker (Mon–Sun)
- "How many suggestions at a time?" — 1 / 2 / 3

**Step 5 — Done**
- Summary of their profile
- "kno is watching for you" confirmation
- Link to their proposals page (`/proposals`)

### 2.4 Proposals page (`/proposals`)

A simple feed showing:
- Upcoming proposed calendar events (with event details, venue, time, price)
- Status: pending / kept / passed
- "Pass on this" button (allows explicit decline even before polling catches it)
- History of past suggestions and outcomes

This page also serves as a lightweight dashboard. No auth beyond Google OAuth session cookie.

---

## Phase 3 — Recommendation Engine

*Goal: given a user's preferences and calendar, find events they'd actually go to and propose them at the right time.*

### 3.1 Google Calendar availability check

For each user, before proposing anything:

1. Pull their Google Calendar events for the next **14 days** using `calendar.events.list`
2. Build a map of "busy" windows (with 1hr buffer before/after existing events)
3. Identify "open windows" that match the user's preferred suggestion days/times
4. Focus on windows of 2+ hours that start after their typical work end time (inferred from `work_location` presence + calendar patterns) for weekday evenings, or any open 3+ hour block on weekends

### 3.2 Rule-based matching pipeline

For each open window, run events through this filter chain:

```
Step 1 — Time filter
  Event must start within the open window (±30min buffer)

Step 2 — Distance filter
  If window is on a weekday evening → measure from work_location
  If window is on weekend → measure from home_location
  Must be within user's max_distance_miles

Step 3 — Budget filter
  Event price must be within user's budget tier

Step 4 — Category match
  Event type and tags must overlap with user's event_types preference

Step 5 — Already proposed filter
  Skip events proposed to this user in the last 60 days

Step 6 — Score remaining candidates
  Base score = number of tag overlaps with user preferences
  Apply interest_matrix weights (e.g. user has kept 3/3 happy_hour proposals → boost weight)
  Boost: free events get +0.3 for budget-conscious users
  Boost: events within 1 mile get +0.2 (walkable)
  Decay: events proposed in last 14 days to *any* user get -0.1 (freshness bonus for less-seen events)

Step 7 — Pick top N
  Select top max_proposals_per_run events by score
  Deduplicate by venue (don't propose the same bar twice in one run)
```

### 3.3 Google Calendar proposal creation

For each selected event, create a Google Calendar event via `calendar.events.insert`:

```
Title:       "🎉 [kno] Pizza & Beer Happy Hour at Breckenridge Brewery"
Description: Full event details + "Suggested by kno based on your preferences.\n\nNot interested? Delete this event."
Start/End:   Event's actual datetime
Location:    Venue address
Color:       "Tomato" (distinctive color so user knows it's a kno proposal)
```

Store the returned `google_calendar_event_id` in `user_event_recommendations`.

### 3.4 Scheduling per user preference

The cron job structure per user:

- `daily` users: run every weekday at their `recommendation_time`
- `2x_week` users: run Monday + Thursday at their `recommendation_time`
- `weekly` users: run Monday at their `recommendation_time`

The main cron tick runs every hour and dispatches only the users whose schedule matches the current time. This is already compatible with `node-cron`.

---

## Phase 4 — Feedback Loop

*Goal: silently learn from what the user keeps and deletes, without asking them to do anything.*

### 4.1 Calendar polling job

Every 6 hours, for each user with pending proposals:

1. Call `calendar.events.get` for each `google_calendar_event_id` stored in `user_event_recommendations`
2. If the event **no longer exists** (404) → mark `user_response: 'deleted'`
3. If the event **still exists** and its start time has passed → mark `user_response: 'kept'`
4. If the event still exists and hasn't happened yet → leave as `'pending'`

### 4.2 Interest matrix update

After recording a response, update `users.interest_matrix`:

- **Kept:** add +0.2 weight to each tag on the event, add venue to `venue_history`
- **Deleted:** add -0.1 weight to each tag on the event (soft signal — maybe timing was just wrong)
- Weights are clamped between 0.3 and 2.0 (never fully exclude a category, never go infinite)
- `last_updated` timestamp updated

This simple weight system means that after 10–15 interactions, kno has a pretty clear picture of what the user actually wants, built entirely from passive signals.

---

## Phase 5 — Multi-City Architecture

*This phase is about making sure everything we build is city-namespaced so expansion is additive, not a rewrite.*

### What to do from day one

- Every `Event` record has a `city` field (default `'denver'`)
- Every `User` record has a `city` field
- Scraper runs are parameterized by city (scraper classes accept a `city` config object with coordinates, neighborhood list, local sources)
- The neighborhood list, local scrape targets (Westword, GoldenBuzz), and event calendar URLs are all stored in a `cities` config file (`src/config/cities.ts`), not hardcoded in scrapers

### Expansion path

When adding a second city (e.g. Austin, Chicago):
1. Add a city entry to `src/config/cities.ts` with its center coordinates, neighborhoods, and city-specific scrape sources
2. Add city-specific scrapers for local publications
3. Configure Eventbrite + Yelp API calls to use the new city's coordinates
4. Users onboarded in that city get matched against that city's event pool

No schema changes needed.

---

## File Structure Changes

```
src/
  config/
    cities.ts          ← NEW: city definitions, neighborhood lists
    database.ts        (existing)
    init.ts            (existing)
    migrations/
      03_expand_events.js     ← NEW
      04_redesign_users.js    ← NEW
      05_expand_recommendations.js  ← NEW

  models/
    event.ts           ← UPDATE: new fields, expanded enums
    user.ts            ← UPDATE: full preference + OAuth model
    userEventRecommendation.ts  ← UPDATE: calendar event ID, response tracking

  services/
    scraper.ts         ← UPDATE: real Eventbrite + Yelp + Westword
    recommendationEngine.ts  ← REWRITE: calendar check + rule-based matching
    calendarService.ts ← NEW: Google Calendar OAuth, event creation, polling
    geocodingService.ts (existing)
    emailService.ts    (keep but deprioritize)

  routes/
    api.ts             ← UPDATE: onboarding endpoints, proposals endpoint
    auth.ts            ← NEW: Google OAuth callback route

  public/              ← NEW: static web UI
    index.html         (landing / onboarding wizard)
    proposals.html     (proposals feed)
    style.css
    app.js

  types/
    index.ts           ← UPDATE: new interfaces for expanded models

  scripts/             (keep existing, add new ones as needed)
    triggerRecommendations.ts  (existing)
    populateEvents.ts          (existing)

  server.ts            ← UPDATE: serve /public, mount auth routes
```

---

## Environment Variables

Add these to `.env` (and `.env.example`):

```
# Existing
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

# New
EVENTBRITE_API_KEY=
YELP_API_KEY=
TOKEN_ENCRYPTION_KEY=        # for encrypting OAuth tokens at rest
APP_URL=                     # e.g. https://kno.onrender.com (used for OAuth redirect)
```

---

## Build Order (Recommended Implementation Sequence)

```
Sprint 1  — Data foundation
  [ ] Migration 03: expand events table
  [ ] Real Eventbrite API scraper
  [ ] Real Yelp Fusion API scraper (happy hours focus)
  [ ] Denver Westword scraper
  [ ] GoldenBuzz scraper hardening
  [ ] cities.ts config file
  [ ] Verify events are populating correctly with script

Sprint 2  — User model + Calendar OAuth
  [ ] Migration 04: redesign users table
  [ ] Migration 05: expand user_event_recommendations
  [ ] Update TypeScript types/interfaces
  [ ] calendarService.ts: OAuth flow (authorize URL, callback, token storage)
  [ ] auth.ts route: /auth/google, /auth/google/callback
  [ ] calendarService.ts: check availability (events.list)
  [ ] calendarService.ts: create proposal event (events.insert)

Sprint 3  — Onboarding UI
  [ ] public/index.html: multi-step onboarding wizard
  [ ] public/proposals.html: proposals feed
  [ ] public/style.css + app.js
  [ ] API endpoints: POST /api/users/onboarding, GET /api/proposals/:userId
  [ ] Session management (simple session cookie, no heavy auth library needed)

Sprint 4  — Recommendation engine rewrite
  [ ] Calendar availability check
  [ ] Rule-based matching pipeline (all 7 steps)
  [ ] Score + rank candidates
  [ ] Create Google Calendar proposals
  [ ] Per-user schedule dispatch via node-cron

Sprint 5  — Feedback loop
  [ ] Calendar polling job (every 6 hours)
  [ ] Detect kept/deleted signals
  [ ] Interest matrix update logic
  [ ] Verify tuning works over several cycles

Sprint 6  — Polish & deploy
  [ ] Rename repo / package.json from activity-recommender → kno
  [ ] Update render.yaml if needed
  [ ] Add new env vars to Render dashboard
  [ ] End-to-end test: onboard one user, let it run for a week
  [ ] README rewrite
```

---

## What Makes the Recommendations Good

The quality bar here is: **if kno suggests something, you'd be annoyed if you missed it.**

A few things that keep quality high without requiring LLMs:

1. **Tag richness on events.** The more tags we apply during ingestion (neighborhood, vibe, price tier, indoor/outdoor, day-of-week, special attributes like `dog_friendly` or `live_music`), the more precisely we can match. Tag quality > event quantity.

2. **Happy hour data accuracy.** Happy hours are the most reliable, repeatable, high-value recommendation type. Getting the days + hours exactly right for each venue (and verifying periodically) is worth significant ongoing effort.

3. **Calendar context.** Knowing the user gets off work at 5pm and has nothing until 9pm on a Thursday is extremely powerful. We use this aggressively.

4. **Not over-proposing.** 2–3 great proposals per run beats 8 mediocre ones. Users who feel like kno "gets them" will keep using it. Users who feel spammed will disconnect their calendar.

5. **Interest matrix accumulation.** After 15–20 interactions, the tag weight system produces a surprisingly accurate fingerprint of what each user actually enjoys — and it requires zero conscious effort from them.

---

## Questions to Resolve Before Coding Starts

1. **Google OAuth credentials** — The `credentials.json` in the repo is present. Does it already have `calendar.events` scope enabled in the Google Cloud Console, or does that need to be added?

2. **Token encryption** — How sensitive do we want to be about storing OAuth refresh tokens? Options range from storing plaintext (fine for MVP) to encrypting with AES-256 using a `TOKEN_ENCRYPTION_KEY`. Recommendation: encrypt from day one.

3. **Who are the initial users?** — MVP is likely just you + 1–2 others. Should the onboarding flow be invite-only (email allowlist) or open signup? Recommendation: allowlist for now, open later.

4. **Yelp happy hour data quality** — Yelp's Fusion API doesn't have a dedicated happy hour hours field; it lives in `attributes` which is spotty. We may need to supplement with manual Google Sheets entries for known happy hour spots. Worth verifying Yelp data quality before betting on it.

5. **Westword scraping legality** — Westword's ToS likely prohibits scraping. Alternatives: use their RSS feed if available, or manually curate their top picks into Google Sheets weekly. Worth checking before writing the scraper.
