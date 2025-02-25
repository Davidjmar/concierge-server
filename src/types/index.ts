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

export interface UserLocation {
  type: string;
  coordinates: number[];
}

export type EventSource = 'eventbrite' | 'yelp' | 'reddit' | 'local_blog';
export type EventType = 'concert' | 'bar' | 'restaurant' | 'art' | 'sports' | 'social';

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

export interface RawEvent {
  title: string;
  description: string;
  sourceUrl: string;
  price: EventPrice;
  location: EventLocation;
  datetime: EventDatetime;
  recurring?: boolean;
  recurrencePattern?: RecurrencePattern;
}

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