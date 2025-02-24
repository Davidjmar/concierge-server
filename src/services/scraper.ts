import axios from 'axios';
import * as cheerio from 'cheerio';
import { RawEvent, EventDatetime } from '../types/index.js';
import Event from '../models/event.js';
import { google } from 'googleapis';
import geocodingService from './geocodingService.js';

interface Location {
  type: string;
  coordinates: number[];
  address?: string;
}

interface HappyHourTime {
  days: string[];
  startTime: string;
  endTime: string;
}

export class Scraper {
  async scrapeEventbrite(location: Location): Promise<RawEvent[]> {
    try {
      // Example implementation
      const address = '123 Example St, Denver, CO';
      const coordinates = await geocodingService.getCoordinates(address);
      
      return [{
        title: 'Example Concert',
        description: 'An amazing concert',
        sourceUrl: 'https://eventbrite.com/example',
        price: { min: 20, max: 50 },
        location: {
          type: 'Point',
          coordinates: coordinates || location.coordinates,
          address: address
        },
        datetime: {
          start: new Date('2024-03-20T19:00:00'),
          end: new Date('2024-03-20T23:00:00')
        },
        recurring: false
      }];
    } catch (error) {
      console.error('Error scraping Eventbrite:', error);
      return [];
    }
  }

  async scrapeReddit(subreddits: string[]): Promise<RawEvent[]> {
    // Implementation for scraping Reddit
    return [];
  }

  async scrapeYelp(location: Location, categories: string[]): Promise<RawEvent[]> {
    try {
      // Example implementation
      const address = '456 Example Ave, Denver, CO';
      const coordinates = await geocodingService.getCoordinates(address);
      
      return [{
        title: 'Happy Hour at Example Bar',
        description: 'Daily happy hour specials',
        sourceUrl: 'https://yelp.com/example-bar',
        price: { min: 5, max: 15 },
        location: {
          type: 'Point',
          coordinates: coordinates || location.coordinates,
          address: address
        },
        datetime: {
          start: new Date('2024-03-20T16:00:00'),
          end: new Date('2024-03-20T19:00:00')
        },
        recurring: true,
        recurrencePattern: {
          frequency: 'daily',
          dayOfWeek: [1,2,3,4,5] // Monday-Friday
        }
      }];
    } catch (error) {
      console.error('Error scraping Yelp:', error);
      return [];
    }
  }

  async scrapeLocalBlogs(location: Location): Promise<RawEvent[]> {
    // Implementation for scraping local blogs
    return [];
  }

  private parsePriceRangeFromSpecials(specials: string): { min: number; max: number } {
    // Default price range if we can't determine from specials
    const defaultRange = { min: 5, max: 15 };
    
    if (!specials) return defaultRange;

    // Common discount patterns to ignore
    const discountPatterns = [
      /\$\d+(?:\.\d{2})?\s*(?:off|OFF)/i,                    // "$X off"
      /\$\d+(?:\.\d{2})?\s*(?:discount|DISCOUNT)/i,          // "$X discount"
      /(?:save|SAVE)\s*\$\d+(?:\.\d{2})?/i,                  // "save $X"
      /\d+%\s*(?:off|OFF)/i,                                 // "X% off"
      /\$\d+(?:\.\d{2})?\s*(?:reduced|REDUCED)/i,            // "$X reduced"
      /reduced\s*(?:by)?\s*\$\d+(?:\.\d{2})?/i,             // "reduced by $X"
      /\$\d+(?:\.\d{2})?\s*(?:savings|SAVINGS)/i,            // "$X savings"
    ];

    // Remove all discount mentions first
    let cleanedSpecials = specials;
    discountPatterns.forEach(pattern => {
      cleanedSpecials = cleanedSpecials.replace(pattern, '');
    });

    // Look for absolute prices
    const priceMatches = cleanedSpecials.match(/\$\d+(?:\.\d{2})?/g);
    if (!priceMatches || priceMatches.length === 0) return defaultRange;

    // Convert matches to numbers
    const prices = priceMatches.map(price => parseFloat(price.replace('$', '')));
    
    // Filter out unreasonably low prices (likely typos or misidentified discounts)
    // For happy hour specials, most items are at least $3-4 even after discount
    const validPrices = prices.filter(price => price >= 3);
    if (validPrices.length === 0) return defaultRange;
    
    // Get min and max prices
    const min = Math.min(...validPrices);
    const max = Math.max(...validPrices);

    // If we only found one price, use it as the min and add a reasonable range
    if (min === max) {
      return { min, max: min + 5 };
    }

    return { min, max };
  }

  async scrapeGoldenBuzz(neighborhood?: string): Promise<Partial<Event>[]> {
    try {
      const baseUrl = 'https://denver.goldenbuzz.social/area/';
      const url = neighborhood ? `${baseUrl}${neighborhood.toLowerCase()}/` : 'https://denver.goldenbuzz.social/happy-hour/';
      
      console.log(`Fetching URL: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      
      // Find all happy hour blocks
      const happyHourElements = $('.brxe-iwsbrg.brxe-block.hh-block');
      console.log(`Found ${happyHourElements.length} happy hour elements`);

      const events: Partial<Event>[] = [];

      for (const element of happyHourElements) {
        const titleElement = $(element).find('.brxe-zthznj.brxe-heading.hh-block__heading a');
        const locationElement = $(element).find('.brxe-tkombj.brxe-post-meta.hh-block__location-meta a');
        const timeElement = $(element).find('.brxe-zqcuny.brxe-post-meta.hh-block__day-and-time-meta');
        
        const title = titleElement.text().trim();
        const venueUrl = titleElement.attr('href');
        const location = locationElement.text().trim();
        
        // Enhance the address with neighborhood context if available
        const fullAddress = neighborhood 
          ? `${location}, ${neighborhood}, Denver, CO`
          : `${location}, Denver, CO`;
        
        // Get coordinates for the location with retries
        let coordinates = null;
        let retryCount = 0;
        while (!coordinates && retryCount < 3) {
          coordinates = await geocodingService.getCoordinates(fullAddress);
          if (!coordinates) {
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
          }
        }

        if (!coordinates) {
          console.warn(`Failed to geocode address after ${retryCount} attempts: ${fullAddress}`);
        }
        
        // Parse days and time
        const timeText = timeElement.text().trim();
        const [daysText, timeRange] = timeText.split('•').map(s => s.trim());
        
        // Remove emojis and clean up text
        const days = daysText.replace('⏰', '').trim();
        
        console.log('Found venue:', {
          title,
          location: fullAddress,
          coordinates,
          days,
          timeRange,
          venueUrl
        });

        // Fetch venue page to get specials
        let specials = '';
        if (venueUrl) {
          try {
            const venueResponse = await axios.get(venueUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
              }
            });
            const venue$ = cheerio.load(venueResponse.data);
            specials = venue$('.brxe-block.hh-block__specials').text().trim();
          } catch (error) {
            console.error(`Error fetching venue page ${venueUrl}:`, error);
          }
        }

        // Convert days text to array of day numbers
        const dayNumbers = this.parseDaysToNumbers(days);
        
        // Parse time range
        let [startTime, endTime] = timeRange.split('-').map(t => t.trim());
        
        // Convert times to 24-hour format
        const startTime24 = this.convertTo24Hour(startTime);
        const endTime24 = this.convertTo24Hour(endTime);

        // Create Date objects for start and end times
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const [startHours, startMinutes] = startTime24.split(':').map(Number);
        const [endHours, endMinutes] = endTime24.split(':').map(Number);
        
        start.setHours(startHours, startMinutes, 0);
        end.setHours(endHours, endMinutes, 0);

        const event: Partial<Event> = {
          title,
          description: specials ? `Happy Hour at ${title}\n\nSpecials:\n${specials}` : `Happy Hour at ${title}`,
          source: 'local_blog',
          source_url: venueUrl,
          type: 'bar',
          price: this.parsePriceRangeFromSpecials(specials),
          location: {
            type: 'Point',
            coordinates: coordinates || [0, 0],
            address: fullAddress
          },
          datetime: {
            start,
            end
          },
          is_active: true,
          recurring: true,
          recurrence_pattern: {
            frequency: 'weekly',
            dayOfWeek: dayNumbers
          }
        };

        events.push(event);
      }

      console.log(`Found ${events.length} happy hour events`);
      return events;
    } catch (error) {
      console.error('Error scraping GoldenBuzz:', error);
      throw error;
    }
  }

  private convertTo24Hour(timeStr: string): string {
    // Remove any spaces and convert to lowercase
    timeStr = timeStr.replace(/\s+/g, '').toLowerCase();
    
    // Extract hours, minutes, and period
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?(?:am|pm)/);
    if (!match) return '00:00';
    
    let [_, hours, minutes] = match;
    let hour = parseInt(hours, 10);
    
    // Check if it's PM and adjust hours accordingly
    if (timeStr.includes('pm') && hour < 12) {
      hour += 12;
    }
    // Handle 12 AM/PM cases
    if (timeStr.includes('am') && hour === 12) {
      hour = 0;
    }
    
    // Format with leading zeros
    return `${hour.toString().padStart(2, '0')}:${(minutes || '00')}`;
  }

  private parseDaysToNumbers(daysText: string): number[] {
    const dayMap: { [key: string]: number } = {
      'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6, 'Sun': 0,
      'Monday': 1, 'Tuesday': 2, 'Wednesday': 3, 'Thursday': 4, 'Friday': 5, 'Saturday': 6, 'Sunday': 0
    };

    if (daysText.toLowerCase() === 'daily') {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    const parts = daysText.split('-').map(s => s.trim());
    if (parts.length === 2) {
      const start = dayMap[parts[0]];
      const end = dayMap[parts[1]];
      
      const days: number[] = [];
      let current = start;
      while (current !== end) {
        days.push(current);
        current = (current + 1) % 7;
      }
      days.push(end);
      return days;
    }

    return daysText.split(',')
      .map(day => day.trim())
      .map(day => dayMap[day])
      .filter(day => day !== undefined);
  }

  async scrapeGoogleSpreadsheet(): Promise<Partial<Event>[]> {
    try {
      // Get all required credentials from environment variables
      const {
        GOOGLE_SHEETS_ID: spreadsheetId,
        GOOGLE_SERVICE_ACCOUNT_TYPE: type,
        GOOGLE_PROJECT_ID: project_id,
        GOOGLE_PRIVATE_KEY_ID: private_key_id,
        GOOGLE_PRIVATE_KEY: privateKey,
        GOOGLE_CLIENT_EMAIL: client_email,
        GOOGLE_CLIENT_ID: client_id,
        GOOGLE_AUTH_URI: auth_uri,
        GOOGLE_TOKEN_URI: token_uri,
        GOOGLE_AUTH_PROVIDER_CERT_URL: auth_provider_x509_cert_url,
        GOOGLE_CLIENT_CERT_URL: client_x509_cert_url,
        GOOGLE_UNIVERSE_DOMAIN: universe_domain
      } = process.env;

      if (!spreadsheetId || !privateKey || !client_email) {
        console.warn('Required Google Sheets credentials not found in environment variables');
        return [];
      }

      const RANGE = 'A2:G100'; // Adjust range as needed

      // Create auth client with service account credentials
      const auth = new google.auth.JWT({
        email: client_email,
        key: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: RANGE,
      });

      const rows = response.data.values;
      if (!rows || rows.length === 0) {
        console.log('No data found in spreadsheet');
        return [];
      }

      const events: Partial<Event>[] = [];

      for (const row of rows) {
        if (!row[0] || !row[1]) continue;

        const [location, times, drinkSpecials, foodSpecials, website, hasPatio] = row;
        
        // Enhance the address with city/state context
        const fullAddress = `${location}, Denver, CO`;
        
        // Get coordinates for the location with retries
        let coordinates = null;
        let retryCount = 0;
        while (!coordinates && retryCount < 3) {
          coordinates = await geocodingService.getCoordinates(fullAddress);
          if (!coordinates) {
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
          }
        }

        if (!coordinates) {
          console.warn(`Failed to geocode address after ${retryCount} attempts: ${fullAddress}`);
        }

        // Parse times and days
        const timeRanges = times.split(',').map((t: string) => t.trim());
        for (const timeRange of timeRanges) {
          // Extract time part (usually in format like "3:00pm-6:00pm" or "3pm-6pm")
          const timeMatch = timeRange.match(/(\d{1,2}(?::\d{2})?(?:am|pm))\s*-\s*(\d{1,2}(?::\d{2})?(?:am|pm))/i);
          if (!timeMatch) continue;

          const [_, startTimeStr, endTimeStr] = timeMatch;
          const startTime = this.convertTo24Hour(startTimeStr);
          const endTime = this.convertTo24Hour(endTimeStr);

          // Extract days
          const days = this.parseDaysFromTimeRange(timeRange);
          
          // Create Date objects for start and end times using today's date
          const now = new Date();
          const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          
          const [startHours, startMinutes] = startTime.split(':').map(Number);
          const [endHours, endMinutes] = endTime.split(':').map(Number);
          
          start.setHours(startHours, startMinutes, 0);
          end.setHours(endHours, endMinutes, 0);

          // Combine drink and food specials for price parsing
          const allSpecials = [drinkSpecials, foodSpecials].filter(Boolean).join('\n');
          
          const event: Partial<Event> = {
            title: `Happy Hour at ${location}`,
            description: `Drink Specials: ${drinkSpecials}\nFood Specials: ${foodSpecials}\nPatio: ${hasPatio === 'Yes' ? 'Available' : 'Not available'}`,
            source: 'local_blog',
            source_url: website || undefined,
            type: 'bar',
            price: this.parsePriceRangeFromSpecials(allSpecials),
            location: {
              type: 'Point',
              coordinates: coordinates || [0, 0],
              address: fullAddress
            },
            datetime: {
              start,
              end
            },
            is_active: true,
            recurring: true,
            recurrence_pattern: {
              frequency: 'weekly',
              dayOfWeek: days
            }
          };

          events.push(event);
        }
      }

      return events;
    } catch (error) {
      console.error('Error scraping Google Spreadsheet:', error);
      throw error;
    }
  }

  private parseDaysFromTimeRange(timeRange: string): number[] {
    const dayMap: { [key: string]: number } = {
      'monday': 1, 'mon': 1,
      'tuesday': 2, 'tue': 2,
      'wednesday': 3, 'wed': 3,
      'thursday': 4, 'thu': 4,
      'friday': 5, 'fri': 5,
      'saturday': 6, 'sat': 6,
      'sunday': 0, 'sun': 0,
      'daily': -1
    };

    const lowerCase = timeRange.toLowerCase();
    
    // Check for "daily" first
    if (lowerCase.includes('daily') || lowerCase.includes('all day')) {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    // Check for day ranges (e.g., "Monday-Friday")
    const rangeMatch = lowerCase.match(/(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*-\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*/);
    if (rangeMatch) {
      const startDay = dayMap[rangeMatch[1]];
      const endDay = dayMap[rangeMatch[2]];
      
      const days: number[] = [];
      let current = startDay;
      while (current !== endDay) {
        days.push(current);
        current = (current + 1) % 7;
      }
      days.push(endDay);
      return days;
    }

    // Check for individual days
    const days: number[] = [];
    Object.entries(dayMap).forEach(([day, num]) => {
      if (lowerCase.includes(day) && num !== -1) {
        days.push(num);
      }
    });

    return days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6]; // Default to daily if no days found
  }
}

export default new Scraper(); 