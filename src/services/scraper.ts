import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawEvent, EventDatetime, EventSource, EventType, HappyHourSchedule } from '../types/index.js';
import Event from '../models/event.js';
import { google } from 'googleapis';
import geocodingService from './geocodingService.js';
import { DENVER } from '../config/cities.js';

interface Location {
  type: string;
  coordinates: number[];
  address?: string;
}

// ─── Eventbrite ───────────────────────────────────────────────────────────────

interface EventbriteEvent {
  id: string;
  name: { text: string };
  description: { text?: string };
  url: string;
  start: { utc: string };
  end: { utc: string };
  is_free: boolean;
  ticket_availability?: { minimum_ticket_price?: { major_value: string }; maximum_ticket_price?: { major_value: string } };
  venue?: { address?: { localized_address_display?: string; latitude?: string; longitude?: string } };
  logo?: { url: string };
  category_id?: string;
}

const EVENTBRITE_CATEGORY_MAP: Record<string, EventType> = {
  '103': 'concert',     // Music
  '110': 'sports',      // Sports & Fitness
  '113': 'art',         // Arts
  '105': 'festival',    // Film & Media
  '114': 'comedy',      // Comedy
  '115': 'social',      // Social
  '116': 'market',      // Shopping & Retail
  '117': 'class',       // Hobbies
  '118': 'market',      // Food & Drink
  '119': 'festival',    // Festival
};

// ─── Yelp ─────────────────────────────────────────────────────────────────────

interface YelpBusiness {
  id: string;
  name: string;
  url: string;
  rating: number;
  price?: string;
  categories: { alias: string; title: string }[];
  coordinates: { latitude: number; longitude: number };
  location: { display_address: string[] };
  image_url?: string;
  hours?: { open: { day: number; start: string; end: string; is_overnight: boolean }[] }[];
  attributes?: { happy_hour?: boolean };
}

function yelpPriceToCost(price?: string): { min: number; max: number } {
  const tiers: Record<string, { min: number; max: number }> = {
    '$': { min: 3, max: 10 },
    '$$': { min: 10, max: 25 },
    '$$$': { min: 25, max: 50 },
    '$$$$': { min: 50, max: 100 },
  };
  return tiers[price ?? '$'] ?? { min: 5, max: 15 };
}

// ─── Main Scraper Class ───────────────────────────────────────────────────────

export class Scraper {

  // ─── Eventbrite ─────────────────────────────────────────────────────────────

  async scrapeEventbrite(location: Location): Promise<RawEvent[]> {
    const apiKey = process.env.EVENTBRITE_API_KEY;
    if (!apiKey) {
      console.warn('EVENTBRITE_API_KEY not set — skipping Eventbrite scrape');
      return [];
    }

    const results: RawEvent[] = [];
    const [lng, lat] = location.coordinates;
    const now = new Date();
    const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= 5) {
        const response = await axios.get('https://www.eventbriteapi.com/v3/events/search/', {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: {
            'location.latitude': lat,
            'location.longitude': lng,
            'location.within': '10mi',
            'start_date.range_start': now.toISOString(),
            'start_date.range_end': twoWeeksOut.toISOString(),
            expand: 'venue,ticket_availability,logo',
            page,
            page_size: 50,
          },
        });

        const data = response.data;
        const events: EventbriteEvent[] = data.events ?? [];

        for (const ev of events) {
          // Skip if already have by external ID (dedup handled in DB by source_url)
          const venueLat = parseFloat(ev.venue?.address?.latitude ?? '0');
          const venueLng = parseFloat(ev.venue?.address?.longitude ?? '0');
          const address = ev.venue?.address?.localized_address_display ?? '';

          const coords: [number, number] =
            venueLat && venueLng
              ? [venueLng, venueLat]
              : (await geocodingService.getCoordinates(address)) ?? [lng, lat];

          const minPrice = ev.is_free
            ? 0
            : parseFloat(ev.ticket_availability?.minimum_ticket_price?.major_value ?? '0');
          const maxPrice = ev.is_free
            ? 0
            : parseFloat(ev.ticket_availability?.maximum_ticket_price?.major_value ?? minPrice.toString());

          const eventType: EventType =
            EVENTBRITE_CATEGORY_MAP[ev.category_id ?? ''] ?? 'social';

          results.push({
            title: ev.name.text,
            description: ev.description?.text ?? '',
            sourceUrl: ev.url,
            source: 'eventbrite',
            type: eventType,
            price: { min: minPrice, max: maxPrice },
            location: { type: 'Point', coordinates: coords, address },
            datetime: {
              start: new Date(ev.start.utc),
              end: new Date(ev.end.utc),
            },
            recurring: false,
            imageUrl: ev.logo?.url,
            city: 'denver',
            externalIds: { eventbrite_id: ev.id },
            tags: [eventType, ev.is_free ? 'free' : 'paid'],
          });
        }

        hasMore = data.pagination?.has_more_items ?? false;
        page++;
      }

      console.log(`Eventbrite: fetched ${results.length} events`);
    } catch (error) {
      console.error('Error scraping Eventbrite:', error);
    }

    return results;
  }

  // ─── Yelp ────────────────────────────────────────────────────────────────────

  async scrapeYelp(location: Location, categories: string[] = ['bars', 'restaurants']): Promise<RawEvent[]> {
    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey) {
      console.warn('YELP_API_KEY not set — skipping Yelp scrape');
      return [];
    }

    const results: RawEvent[] = [];
    const [lng, lat] = location.coordinates;

    try {
      let offset = 0;
      let total = Infinity;

      while (offset < total && offset < 200) {
        const response = await axios.get('https://api.yelp.com/v3/businesses/search', {
          headers: { Authorization: `Bearer ${apiKey}` },
          params: {
            latitude: lat,
            longitude: lng,
            radius: 16000, // ~10 miles in meters
            categories: categories.join(','),
            limit: 50,
            offset,
            open_now: false,
          },
        });

        const businesses: YelpBusiness[] = response.data.businesses ?? [];
        total = response.data.total ?? 0;

        for (const biz of businesses) {
          const coords: [number, number] = [biz.coordinates.longitude, biz.coordinates.latitude];
          const address = biz.location.display_address.join(', ');
          const cost = yelpPriceToCost(biz.price);

          const tags: string[] = ['happy_hour'];
          if (biz.categories.some(c => c.alias.includes('bar') || c.alias.includes('pub'))) {
            tags.push('craft_beer');
          }
          if (biz.categories.some(c => c.alias.includes('cocktail'))) {
            tags.push('cocktails');
          }
          if (biz.categories.some(c => c.alias.includes('restaurant') || c.alias.includes('food'))) {
            tags.push('food');
          }

          // Build happy hour schedule from Yelp hours if available
          let happyHourSchedule: HappyHourSchedule | undefined;
          const hours = biz.hours?.[0]?.open;
          if (hours && hours.length > 0) {
            // Assume happy hour is from 4–6pm on days the venue is open
            // Yelp happy_hour attribute is unreliable; we default to 4–6pm pattern
            const days = hours.map(h => {
              const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
              return dayNames[h.day];
            });
            const uniqueDays = [...new Set(days)];
            happyHourSchedule = { days: uniqueDays, start: '16:00', end: '18:00' };
          }

          const dayNumbers =
            biz.hours?.[0]?.open?.map(h => h.day) ?? [1, 2, 3, 4, 5];

          // Use today's date with a standard happy hour window
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 16, 0, 0);
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);

          results.push({
            title: `Happy Hour at ${biz.name}`,
            description: `Happy hour specials at ${biz.name}. Rating: ${biz.rating}/5.`,
            sourceUrl: biz.url,
            source: 'yelp',
            type: 'bar',
            price: cost,
            location: { type: 'Point', coordinates: coords, address },
            datetime: { start, end },
            recurring: true,
            recurrencePattern: { frequency: 'weekly', dayOfWeek: dayNumbers },
            tags,
            venueName: biz.name,
            city: 'denver',
            imageUrl: biz.image_url,
            externalIds: { yelp_id: biz.id },
            happyHourSchedule,
          });
        }

        offset += 50;
        // Respect rate limits
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`Yelp: fetched ${results.length} happy hour venues`);
    } catch (error) {
      console.error('Error scraping Yelp:', error);
    }

    return results;
  }

  // ─── Westword ────────────────────────────────────────────────────────────────

  private readonly WESTWORD_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  /**
   * Scrapes Westword Denver for events and food/drink coverage.
   *
   * Part 1 — Events calendar (/things-to-do):
   *   Collects event page URLs, then fetches each page and extracts
   *   Schema.org JSON-LD structured data (title, date, venue, address,
   *   price). Only factual fields present in the structured data are used.
   *
   * Part 2 — Food & Drink RSS:
   *   Pulls the main RSS feed and filters for food/drink/restaurant items
   *   published in the last 30 days. Used as editorial context for
   *   restaurants and happy hours — no address inference is done here.
   */
  async scrapeWestword(): Promise<RawEvent[]> {
    const results: RawEvent[] = [];

    // Part 1: structured event data from the events calendar
    try {
      const eventLinks = await this.fetchWestwordEventLinks();
      console.log(`Westword: found ${eventLinks.length} event page links`);

      let parsed = 0;
      for (const url of eventLinks) {
        try {
          const event = await this.parseWestwordEventPage(url);
          if (event) { results.push(event); parsed++; }
        } catch {
          // per-page errors are non-fatal
        }
        await new Promise(r => setTimeout(r, 400)); // polite crawling delay
      }
      console.log(`Westword events: parsed ${parsed}/${eventLinks.length}`);
    } catch (err) {
      console.error('Westword: error in events calendar scrape:', err);
    }

    // Part 2: recent Food & Drink RSS items
    try {
      const foodItems = await this.fetchWestwordFoodRSS();
      results.push(...foodItems);
      console.log(`Westword RSS food/drink: ${foodItems.length} items`);
    } catch (err) {
      console.error('Westword: error in RSS food scrape:', err);
    }

    console.log(`Westword: total ${results.length} items`);
    return results;
  }

  /** Fetches the /things-to-do listing page and returns unique event page URLs. */
  private async fetchWestwordEventLinks(): Promise<string[]> {
    const resp = await axios.get('https://www.westword.com/things-to-do', {
      headers: this.WESTWORD_HEADERS,
      timeout: 15000,
    });

    const $ = cheerio.load(resp.data);
    const links = new Set<string>();

    $('a[href*="/event/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      const full = href.startsWith('http') ? href : `https://www.westword.com${href}`;
      if (!full.includes('westword.com')) return;
      links.add(full.split('?')[0]); // strip query params
    });

    return [...links].slice(0, 40); // cap per run to avoid overloading
  }

  /**
   * Fetches a single Westword event page and extracts the Schema.org
   * Event JSON-LD block. Returns null if no structured data is found.
   * Only fields present in the JSON-LD are used — no inference.
   */
  private async parseWestwordEventPage(url: string): Promise<RawEvent | null> {
    const resp = await axios.get(url, {
      headers: this.WESTWORD_HEADERS,
      timeout: 10000,
    });

    const $ = cheerio.load(resp.data);

    // Find Schema.org Event JSON-LD
    let jsonLd: any = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (jsonLd) return; // already found one
      try {
        const raw = JSON.parse($(el).text());
        const candidates = Array.isArray(raw) ? raw : [raw];
        for (const c of candidates) {
          const types = Array.isArray(c['@type']) ? c['@type'] : [c['@type']];
          if (types.includes('Event')) { jsonLd = c; break; }
        }
      } catch { /* malformed JSON-LD — skip */ }
    });

    if (!jsonLd) return null;

    // ── Required fields ──
    const title = typeof jsonLd.name === 'string' ? jsonLd.name.trim() : null;
    if (!title) return null;

    const startDate = jsonLd.startDate ? new Date(jsonLd.startDate) : null;
    if (!startDate || isNaN(startDate.getTime())) return null;

    const endDate = jsonLd.endDate ? new Date(jsonLd.endDate) : null;

    // ── Location — only use what's in the structured data ──
    const locationData = jsonLd.location;
    const venueName = (locationData?.name ?? '').trim();
    const addrObj = locationData?.address;
    let streetAddress = '';
    if (typeof addrObj === 'string') {
      streetAddress = addrObj;
    } else if (addrObj && typeof addrObj === 'object') {
      streetAddress = [
        addrObj.streetAddress,
        addrObj.addressLocality,
        addrObj.addressRegion,
        addrObj.postalCode,
      ].filter(Boolean).join(', ');
    }

    // Geocode only when we have a real street address
    let coords: [number, number] = [DENVER.center.lng, DENVER.center.lat];
    if (streetAddress && !/^Denver,?\s*(CO)?$/i.test(streetAddress)) {
      const geocoded = await geocodingService.getCoordinates(streetAddress) as [number, number] | null;
      if (geocoded) coords = geocoded;
    }

    // ── Price — from offers object/array ──
    let minPrice = 0;
    let maxPrice = 0;
    const offers = jsonLd.offers;
    if (offers) {
      const arr: any[] = Array.isArray(offers) ? offers : [offers];
      const lowPrices = arr.map(o => parseFloat(o.price ?? o.lowPrice ?? 'NaN')).filter(p => !isNaN(p) && p >= 0);
      const highPrices = arr.map(o => parseFloat(o.highPrice ?? 'NaN')).filter(p => !isNaN(p) && p > 0);
      if (lowPrices.length) minPrice = Math.min(...lowPrices);
      maxPrice = highPrices.length ? Math.max(...highPrices) : (lowPrices.length ? Math.max(...lowPrices) : 0);
    }

    // ── Description — strip any HTML tags ──
    const description = (jsonLd.description ?? '').replace(/<[^>]+>/g, '').trim();

    // ── Event type — classified only from title/description text ──
    const lower = (title + ' ' + description).toLowerCase();
    let type: EventType = 'social';
    if (/concert|live music|live band|perform/i.test(lower)) type = 'concert';
    else if (/comedy|stand.?up/i.test(lower)) type = 'comedy';
    else if (/\bart\b|gallery|exhibit/i.test(lower)) type = 'art';
    else if (/film|movie|cinema|screening/i.test(lower)) type = 'film';
    else if (/market|festival|fest\b/i.test(lower)) type = 'festival';
    else if (/trivia/i.test(lower)) type = 'trivia';
    else if (/class|workshop/i.test(lower)) type = 'class';
    else if (/happy hour/i.test(lower)) type = 'bar';

    const tags: string[] = [type, 'westword'];
    if (minPrice === 0 && maxPrice === 0) tags.push('free');
    if (/outdoor|outside|patio|park/i.test(lower)) tags.push('outdoor');
    if (/food|eat|dine|dinner|lunch/i.test(lower)) tags.push('food');
    if (/beer|brew/i.test(lower)) tags.push('craft_beer');
    if (/wine/i.test(lower)) tags.push('wine');
    if (/cocktail/i.test(lower)) tags.push('cocktails');

    const imageUrl = typeof jsonLd.image === 'string'
      ? jsonLd.image
      : Array.isArray(jsonLd.image)
      ? jsonLd.image[0]?.url ?? jsonLd.image[0]
      : jsonLd.image?.url;

    return {
      title,
      description,
      sourceUrl: url,
      source: 'westword',
      type,
      price: { min: minPrice, max: maxPrice },
      location: {
        type: 'Point',
        coordinates: coords,
        address: streetAddress || 'Denver, CO',
      },
      datetime: {
        start: startDate,
        end: endDate ?? new Date(startDate.getTime() + 2 * 3600000),
      },
      recurring: false,
      tags,
      city: 'denver',
      venueName: venueName || undefined,
      imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
    };
  }

  /**
   * Fetches Westword's main RSS feed and returns Food & Drink items
   * published within the last 30 days. Address fields are not available
   * from RSS, so location defaults to Denver center.
   */
  private async fetchWestwordFoodRSS(): Promise<RawEvent[]> {
    const results: RawEvent[] = [];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const resp = await axios.get('https://www.westword.com/feed/', {
      headers: this.WESTWORD_HEADERS,
      timeout: 10000,
    });

    const $ = cheerio.load(resp.data, { xmlMode: true });

    $('item').each((_, el) => {
      // Only food/drink/restaurant editorial coverage
      const categories = $(el).find('category').map((__, c) => $(c).text().toLowerCase()).get();
      const isFood = categories.some(c => c.includes('food') || c.includes('drink') || c.includes('restaurant'));
      if (!isFood) return;

      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const description = $(el).find('description').text().replace(/<[^>]+>/g, '').trim().slice(0, 600);
      const pubDateStr = $(el).find('pubDate').text().trim();
      const pubDate = pubDateStr ? new Date(pubDateStr) : null;

      if (!title || !link || !pubDate || isNaN(pubDate.getTime())) return;
      if (pubDate < thirtyDaysAgo) return; // only recent coverage

      const lower = (title + ' ' + description).toLowerCase();
      let type: EventType = 'social';
      if (/happy hour/i.test(lower)) type = 'bar';
      else if (/concert|live music/i.test(lower)) type = 'concert';
      else if (/festival|market/i.test(lower)) type = 'festival';

      const tags: string[] = ['westword', 'food'];
      if (type === 'bar') tags.push('happy_hour');
      if (/free/i.test(lower)) tags.push('free');
      if (/outdoor|patio/i.test(lower)) tags.push('outdoor');

      // Use publication date as the reference date for the item
      const start = new Date(pubDate);
      start.setHours(18, 0, 0, 0);
      const end = new Date(pubDate);
      end.setHours(22, 0, 0, 0);

      results.push({
        title,
        description,
        sourceUrl: link,
        source: 'westword',
        type,
        price: { min: 0, max: 30 },
        location: {
          type: 'Point',
          coordinates: [DENVER.center.lng, DENVER.center.lat],
          address: 'Denver, CO',
        },
        datetime: { start, end },
        recurring: false,
        tags,
        city: 'denver',
      });
    });

    return results;
  }

  // ─── GoldenBuzz ──────────────────────────────────────────────────────────────

  async scrapeGoldenBuzz(neighborhood?: string): Promise<Partial<Event>[]> {
    try {
      let urlNeighborhood = neighborhood?.toLowerCase();
      if (urlNeighborhood === 'rino') {
        urlNeighborhood = 'river-north-art-district';
      }

      const baseUrl = 'https://denver.goldenbuzz.social/area/';
      const url = neighborhood
        ? `${baseUrl}${urlNeighborhood}/`
        : 'https://denver.goldenbuzz.social/happy-hour/';

      console.log(`GoldenBuzz: fetching ${url}`);

      const response = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        },
        timeout: 15000,
      });

      const $ = cheerio.load(response.data);
      const happyHourElements = $('.brxe-iwsbrg.brxe-block.hh-block');
      console.log(`GoldenBuzz [${neighborhood}]: found ${happyHourElements.length} elements`);

      const events: Partial<Event>[] = [];

      for (const element of happyHourElements) {
        // Per-venue error recovery — one failure doesn't abort the run
        try {
          const titleEl = $(element).find('.brxe-zthznj.brxe-heading.hh-block__heading a');
          const locationEl = $(element).find('.brxe-tkombj.brxe-post-meta.hh-block__location-meta a');
          const timeEl = $(element).find('.brxe-zqcuny.brxe-post-meta.hh-block__day-and-time-meta');

          const title = titleEl.text().trim();
          const venueUrl = titleEl.attr('href');
          const locationText = locationEl.text().trim();

          if (!title || !locationText) continue;

          const fullAddress = neighborhood
            ? `${locationText}, ${neighborhood}, Denver, CO`
            : `${locationText}, Denver, CO`;

          let coordinates: [number, number] | null = null;
          for (let attempt = 0; attempt < 3 && !coordinates; attempt++) {
            coordinates = await geocodingService.getCoordinates(fullAddress) as [number, number] | null;
            if (!coordinates) await new Promise(r => setTimeout(r, 1000));
          }

          if (!coordinates) {
            console.warn(`GoldenBuzz: failed to geocode ${fullAddress}, using Denver center`);
            coordinates = [DENVER.center.lng, DENVER.center.lat];
          }

          const timeText = timeEl.text().trim();
          const parts = timeText.split('•').map((s: string) => s.trim());
          const daysText = (parts[0] ?? '').replace('⏰', '').trim();
          const timeRange = parts[1] ?? '';

          const [startTimeStr, endTimeStr] = timeRange.split('-').map((t: string) => t.trim());
          const startTime24 = startTimeStr ? this.convertTo24Hour(startTimeStr) : '16:00';
          const endTime24 = endTimeStr ? this.convertTo24Hour(endTimeStr) : '18:00';

          const [sh, sm] = startTime24.split(':').map(Number);
          const [eh, em] = endTime24.split(':').map(Number);
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0);
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0);

          const dayNumbers = this.parseDaysToNumbers(daysText);

          // Fetch specials page for this venue
          let specials = '';
          if (venueUrl) {
            try {
              const venueResp = await axios.get(venueUrl, {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                },
                timeout: 10000,
              });
              const v$ = cheerio.load(venueResp.data);
              specials = v$('.brxe-block.hh-block__specials').text().trim();
            } catch {
              // non-fatal — continue without specials
            }
          }

          // Check for stale/expired listings — skip if no active days found
          if (dayNumbers.length === 0) {
            console.warn(`GoldenBuzz: no valid days parsed for ${title}, skipping`);
            continue;
          }

          const tags: string[] = ['happy_hour'];
          if (/beer|brew/i.test(specials)) tags.push('craft_beer');
          if (/cocktail|spirit/i.test(specials)) tags.push('cocktails');
          if (/wine/i.test(specials)) tags.push('wine');
          if (/food|bite|appetizer/i.test(specials)) tags.push('food');
          if (/outdoor|patio/i.test(specials)) tags.push('outdoor');

          // Normalize neighborhood to slug
          const neighborhoodSlug = neighborhood?.toLowerCase().replace(/\s+/g, '-');

          events.push({
            title,
            description: specials
              ? `Happy Hour at ${title}\n\nSpecials:\n${specials}`
              : `Happy Hour at ${title}`,
            source: 'goldenbuzz' as EventSource,
            source_url: venueUrl,
            type: 'bar',
            price: this.parsePriceRangeFromSpecials(specials),
            location: { type: 'Point', coordinates, address: fullAddress },
            datetime: { start, end },
            is_active: true,
            recurring: true,
            recurrence_pattern: { frequency: 'weekly', dayOfWeek: dayNumbers },
            city: 'denver',
            neighborhood: neighborhoodSlug,
            venue_name: title,
            tags,
            happy_hour_schedule: {
              days: dayNumbers.map(d => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d]),
              start: startTime24,
              end: endTime24,
            },
          } as Partial<Event>);
        } catch (venueError) {
          console.error(`GoldenBuzz: error processing venue in ${neighborhood}:`, venueError);
          // Continue to next venue
        }
      }

      console.log(`GoldenBuzz [${neighborhood}]: processed ${events.length} events`);
      return events;
    } catch (error) {
      console.error(`GoldenBuzz: error scraping neighborhood ${neighborhood}:`, error);
      return []; // Return empty array instead of throwing — caller handles aggregation
    }
  }

  // ─── Google Sheets ────────────────────────────────────────────────────────────

  async scrapeGoogleSpreadsheet(): Promise<Partial<Event>[]> {
    try {
      const {
        GOOGLE_SHEETS_ID: spreadsheetId,
        GOOGLE_PRIVATE_KEY: privateKey,
        GOOGLE_CLIENT_EMAIL: client_email,
      } = process.env;

      if (!spreadsheetId || !privateKey || !client_email) {
        console.warn('Google Sheets credentials not set — skipping');
        return [];
      }

      const auth = new google.auth.JWT({
        email: client_email,
        key: privateKey.replace(/\\n/g, '\n'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'A2:H100', // Added column H for tags
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log('Google Sheets: no data found');
        return [];
      }

      const events: Partial<Event>[] = [];

      for (const row of rows) {
        if (!row[0] || !row[1]) continue;

        const [location, times, drinkSpecials, foodSpecials, website, hasPatio, neighborhoodCol, tagsCol] = row;

        const fullAddress = `${location}, Denver, CO`;
        let coordinates: [number, number] | null = null;

        for (let attempt = 0; attempt < 3 && !coordinates; attempt++) {
          coordinates = await geocodingService.getCoordinates(fullAddress) as [number, number] | null;
          if (!coordinates) await new Promise(r => setTimeout(r, 1000));
        }

        if (!coordinates) {
          console.warn(`Google Sheets: failed to geocode ${fullAddress}`);
          coordinates = [DENVER.center.lng, DENVER.center.lat];
        }

        const timeRanges = times.split(',').map((t: string) => t.trim());

        for (const timeRange of timeRanges) {
          const timeMatch = timeRange.match(
            /(\d{1,2}(?::\d{2})?(?:am|pm))\s*-\s*(\d{1,2}(?::\d{2})?(?:am|pm))/i
          );
          if (!timeMatch) continue;

          const startTime = this.convertTo24Hour(timeMatch[1]);
          const endTime = this.convertTo24Hour(timeMatch[2]);
          const days = this.parseDaysFromTimeRange(timeRange);

          const now = new Date();
          const [sh, sm] = startTime.split(':').map(Number);
          const [eh, em] = endTime.split(':').map(Number);
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), sh, sm, 0);
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), eh, em, 0);

          const allSpecials = [drinkSpecials, foodSpecials].filter(Boolean).join('\n');

          const tags: string[] = ['happy_hour'];
          if (hasPatio === 'Yes') tags.push('outdoor');
          if (tagsCol) {
            tagsCol.split(',').map((t: string) => t.trim()).forEach((t: string) => tags.push(t));
          }

          events.push({
            title: `Happy Hour at ${location}`,
            description: `Drink Specials: ${drinkSpecials || 'N/A'}\nFood Specials: ${foodSpecials || 'N/A'}\nPatio: ${hasPatio === 'Yes' ? 'Available' : 'Not available'}`,
            source: 'google_sheets' as EventSource,
            source_url: website || undefined,
            type: 'bar',
            price: this.parsePriceRangeFromSpecials(allSpecials),
            location: { type: 'Point', coordinates, address: fullAddress },
            datetime: { start, end },
            is_active: true,
            recurring: true,
            recurrence_pattern: { frequency: 'weekly', dayOfWeek: days },
            city: 'denver',
            neighborhood: neighborhoodCol?.toLowerCase().trim(),
            venue_name: location,
            tags,
            happy_hour_schedule: {
              days: days.map(d => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d]),
              start: startTime,
              end: endTime,
            },
          } as Partial<Event>);
        }
      }

      console.log(`Google Sheets: fetched ${events.length} events`);
      return events;
    } catch (error) {
      console.error('Error scraping Google Spreadsheet:', error);
      return [];
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private parsePriceRangeFromSpecials(specials: string): { min: number; max: number } {
    const defaultRange = { min: 5, max: 15 };
    if (!specials) return defaultRange;

    const discountPatterns = [
      /\$\d+(?:\.\d{2})?\s*(?:off|OFF)/i,
      /\$\d+(?:\.\d{2})?\s*(?:discount|DISCOUNT)/i,
      /(?:save|SAVE)\s*\$\d+(?:\.\d{2})?/i,
      /\d+%\s*(?:off|OFF)/i,
      /\$\d+(?:\.\d{2})?\s*(?:reduced|REDUCED)/i,
    ];

    let cleaned = specials;
    discountPatterns.forEach(p => { cleaned = cleaned.replace(p, ''); });

    const matches = cleaned.match(/\$\d+(?:\.\d{2})?/g);
    if (!matches) return defaultRange;

    const prices = matches.map(p => parseFloat(p.replace('$', ''))).filter(p => p >= 3);
    if (prices.length === 0) return defaultRange;

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return { min, max: min === max ? min + 5 : max };
  }

  private convertTo24Hour(timeStr: string): string {
    timeStr = timeStr.replace(/\s+/g, '').toLowerCase();
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?(?:am|pm)/);
    if (!match) return '00:00';
    let hour = parseInt(match[1], 10);
    const minutes = match[2] ?? '00';
    if (timeStr.includes('pm') && hour < 12) hour += 12;
    if (timeStr.includes('am') && hour === 12) hour = 0;
    return `${hour.toString().padStart(2, '0')}:${minutes}`;
  }

  private parseDaysToNumbers(daysText: string): number[] {
    const dayMap: Record<string, number> = {
      Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0,
      Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 0,
    };

    if (!daysText || daysText.toLowerCase() === 'daily') return [0, 1, 2, 3, 4, 5, 6];

    const parts = daysText.split('-').map(s => s.trim());
    if (parts.length === 2 && dayMap[parts[0]] !== undefined && dayMap[parts[1]] !== undefined) {
      const start = dayMap[parts[0]];
      const end = dayMap[parts[1]];
      const days: number[] = [];
      let cur = start;
      while (cur !== end) {
        days.push(cur);
        cur = (cur + 1) % 7;
      }
      days.push(end);
      return days;
    }

    return daysText
      .split(',')
      .map(d => dayMap[d.trim()])
      .filter(d => d !== undefined);
  }

  private parseDaysFromTimeRange(timeRange: string): number[] {
    const dayMap: Record<string, number> = {
      monday: 1, mon: 1,
      tuesday: 2, tue: 2,
      wednesday: 3, wed: 3,
      thursday: 4, thu: 4,
      friday: 5, fri: 5,
      saturday: 6, sat: 6,
      sunday: 0, sun: 0,
    };

    const lower = timeRange.toLowerCase();
    if (lower.includes('daily') || lower.includes('all day')) return [0, 1, 2, 3, 4, 5, 6];

    const rangeMatch = lower.match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*-\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/);
    if (rangeMatch) {
      const start = dayMap[rangeMatch[1]];
      const end = dayMap[rangeMatch[2]];
      const days: number[] = [];
      let cur = start;
      while (cur !== end) {
        days.push(cur);
        cur = (cur + 1) % 7;
      }
      days.push(end);
      return days;
    }

    const days: number[] = [];
    Object.entries(dayMap).forEach(([day, num]) => {
      if (lower.includes(day)) days.push(num);
    });

    return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];
  }

  // ─── Deprecated stubs (kept for interface compat) ─────────────────────────────

  async scrapeReddit(_subreddits: string[]): Promise<RawEvent[]> {
    return [];
  }

  async scrapeLocalBlogs(_location: Location): Promise<RawEvent[]> {
    return [];
  }
}

export default new Scraper();
