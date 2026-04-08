// ─── City timezone utility ────────────────────────────────────────────────────
// Maps kno city slugs to IANA timezone names. Add a new entry here when
// launching in a new city — everything else derives from this table.

const CITY_TIMEZONES: Record<string, string> = {
  denver:      'America/Denver',
  chicago:     'America/Chicago',
  dallas:      'America/Chicago',
  houston:     'America/Chicago',
  new_york:    'America/New_York',
  miami:       'America/New_York',
  boston:      'America/New_York',
  atlanta:     'America/New_York',
  los_angeles: 'America/Los_Angeles',
  seattle:     'America/Los_Angeles',
  portland:    'America/Los_Angeles',
  phoenix:     'America/Phoenix',
};

/**
 * Returns the UTC offset in hours for a given city at a given moment.
 * Positive = behind UTC (e.g., Denver MDT → 6, Denver MST → 7).
 * DST is handled automatically via the Node.js IANA timezone database.
 */
export function getCityUTCOffset(city: string, now: Date): number {
  const tz = CITY_TIMEZONES[city?.toLowerCase().trim()] ?? 'America/Denver';
  // Compare the same moment expressed in the target tz vs UTC to get the offset.
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utc   = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((utc.getTime() - local.getTime()) / 3_600_000);
}

/**
 * Returns a Date whose UTC fields reflect the city's local time.
 * e.g. for Denver MDT at 14:00 UTC, returns a Date where getUTCHours() === 8.
 * Useful for day-of-week and hour calculations without string formatting.
 */
export function toCityLocalDate(city: string, now: Date): Date {
  const offset = getCityUTCOffset(city, now);
  return new Date(now.getTime() - offset * 3_600_000);
}
