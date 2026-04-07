// ─── Event ───────────────────────────────────────────────────────────────────

export type EventSource =
  | 'eventbrite'
  | 'yelp'
  | 'goldenbuzz'
  | 'westword'
  | 'google_sheets'
  | 'denver_gov'
  | 'city_park_jazz'
  | 'botanic_gardens'
  | 'edmtrain'
  | 'manual'
  | 'reddit'
  | 'local_blog';

export type EventType =
  | 'concert'
  | 'bar'
  | 'restaurant'
  | 'art'
  | 'sports'
  | 'social'
  | 'festival'
  | 'class'
  | 'comedy'
  | 'trivia'
  | 'film'
  | 'market'
  | 'park';

export interface EventPrice {
  min?: number;
  max?: number;
}

export interface EventLocation {
  type: string;
  coordinates: number[];
  address?: string;
}

export interface EventDatetime {
  start: Date;
  end: Date;
}

export interface RecurrencePattern {
  frequency: string;
  dayOfWeek: number[];
  dayOfMonth?: number;
}

export interface HappyHourSchedule {
  days: string[];   // e.g. ['mon', 'tue', 'wed', 'thu', 'fri']
  start: string;    // 24h format, e.g. '16:00'
  end: string;      // 24h format, e.g. '18:00'
}

export interface ExternalIds {
  eventbrite_id?: string;
  yelp_id?: string;
  google_place_id?: string;
}

export interface RawEvent {
  title: string;
  description: string;
  sourceUrl: string;
  source?: EventSource;
  type?: EventType;
  price: EventPrice;
  location: EventLocation;
  datetime: EventDatetime;
  recurring?: boolean;
  recurrencePattern?: RecurrencePattern;
  tags?: string[];
  venueName?: string;
  neighborhood?: string;
  city?: string;
  imageUrl?: string;
  happyHourSchedule?: HappyHourSchedule;
  externalIds?: ExternalIds;
}

// ─── User ─────────────────────────────────────────────────────────────────────

export interface UserPreferencesV2 {
  food?: string[];          // e.g. ['pizza', 'tacos', 'sushi']
  drink?: string[];         // e.g. ['craft_beer', 'cocktails', 'wine']
  dietary?: string[];       // e.g. ['vegetarian', 'vegan', 'gluten_free']
  event_types?: string[];   // e.g. ['concert', 'happy_hour', 'trivia']
  vibe?: string[];          // e.g. ['chill', 'lively', 'date_night']
  activity_level?: 'low' | 'medium' | 'high';
  indoor_outdoor?: 'indoor' | 'outdoor' | 'no_preference';
  budget?: 'free' | 'budget' | 'moderate' | 'splurge';
  max_distance_miles?: number;
  custom_interests?: string[];  // freeform interest seeds, e.g. ['coworking lunch deals', 'grand openings']
}

/** @deprecated use UserPreferencesV2 */
export interface UserPreferences {
  concerts: boolean;
  cocktailBars: boolean;
  painting: boolean;
  watches: boolean;
  walkingDistance: boolean;
  speedDating: boolean;
  maxDistance: number;
  priceRange: {
    min: number;
    max: number;
  };
}

export interface GeoPoint {
  coordinates: [number, number]; // [lng, lat]
  address?: string;
  neighborhood?: string;
}

/** @deprecated use GeoPoint */
export interface UserLocation {
  type: string;
  coordinates: number[];
}

export interface TagWeights {
  [tag: string]: number;
}

export interface VenueHistoryEntry {
  times_proposed: number;
  times_kept: number;
}

export interface InterestMatrix {
  tag_weights: TagWeights;
  venue_history: Record<string, VenueHistoryEntry>;
  last_updated: string;
}

// ─── Recommendation ───────────────────────────────────────────────────────────

export type UserResponse = 'kept' | 'deleted' | 'pending';

export type DeliveryTiming = 'day_of' | 'sunday' | 'smart';

// ─── Shared ───────────────────────────────────────────────────────────────────

export interface WhereQuery {
  [key: string]: any;
}

export type EmailServiceResponse = {
  success: boolean;
} & ({
  sent: number;
} | {
  error: string;
});
