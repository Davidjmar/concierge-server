import { Client, GeocodeResponse } from '@googlemaps/google-maps-services-js';
import dotenv from 'dotenv';

dotenv.config();

// Denver area bounds (roughly)
const DENVER_BOUNDS = {
  south: 39.614431,
  west: -105.109927,
  north: 39.798058,
  east: -104.889197
};

// Default coordinates for Denver downtown when geocoding fails
const DENVER_DEFAULT: [number, number] = [-104.9847, 39.7392];

class GeocodingService {
  private client: Client;
  private apiKey: string | undefined;
  private coordinateCache: Map<string, [number, number]> = new Map();

  constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
    
    if (!this.apiKey) {
      console.warn('GOOGLE_GEOCODING_API_KEY not found in environment variables. Geocoding will be disabled.');
    }
  }

  private isWithinDenver(lat: number, lng: number): boolean {
    return lat >= DENVER_BOUNDS.south && 
           lat <= DENVER_BOUNDS.north && 
           lng >= DENVER_BOUNDS.west && 
           lng <= DENVER_BOUNDS.east;
  }

  async geocodeAddress(address: string): Promise<[number, number] | null> {
    if (!this.apiKey) {
      console.warn('Geocoding skipped - no API key available');
      return null;
    }

    try {
      // Handle special cases for neighborhoods
      let searchAddress = address;
      if (address === 'Highlands') {
        searchAddress = 'Highlands neighborhood, Denver, CO';
      } else if (address.match(/^[A-Za-z\s]+$/)) {
        searchAddress = `${address}, Denver, CO`;
      }

      const response = await this.client.geocode({
        params: {
          address: searchAddress,
          key: this.apiKey,
          components: { country: 'US' },
          bounds: {
            southwest: { lat: DENVER_BOUNDS.south, lng: DENVER_BOUNDS.west },
            northeast: { lat: DENVER_BOUNDS.north, lng: DENVER_BOUNDS.east }
          }
        }
      });

      if (response.data.results && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        
        // Validate the coordinates are within Denver bounds
        if (this.isWithinDenver(location.lat, location.lng)) {
          return [location.lng, location.lat];  // GeoJSON uses [longitude, latitude]
        } else {
          console.warn(`Geocoded location for "${searchAddress}" is outside Denver bounds:`, 
            `[${location.lng}, ${location.lat}]`);
          return DENVER_DEFAULT;
        }
      }

      console.warn(`No results found for address: ${searchAddress}`);
      return DENVER_DEFAULT;
    } catch (error) {
      console.error('Error geocoding address:', error);
      return DENVER_DEFAULT;
    }
  }

  async getCoordinates(address: string): Promise<[number, number] | null> {
    // Check cache first
    const cachedCoordinates = this.coordinateCache.get(address);
    if (cachedCoordinates) {
      return cachedCoordinates;
    }

    // If not in cache, geocode and cache the result
    const coordinates = await this.geocodeAddress(address);
    if (coordinates) {
      this.coordinateCache.set(address, coordinates);
    }
    return coordinates;
  }

  // Helper method to batch geocode addresses
  async batchGeocode(addresses: string[]): Promise<Map<string, [number, number]>> {
    const results = new Map<string, [number, number]>();
    
    // Process in batches of 10 with a delay between batches
    const batchSize = 10;
    for (let i = 0; i < addresses.length; i += batchSize) {
      const batch = addresses.slice(i, i + batchSize);
      await Promise.all(batch.map(async (address) => {
        const coords = await this.getCoordinates(address);
        if (coords) {
          results.set(address, coords);
        }
      }));
      
      // Wait 1 second between batches to respect rate limits
      if (i + batchSize < addresses.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
}

export default new GeocodingService(); 