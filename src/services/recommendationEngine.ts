import User from '../models/user.js';
import Event from '../models/event.js';
import UserEventRecommendation from '../models/userEventRecommendation.js';
import scraper from './scraper.js';
import emailService from './emailService.js';
import { WhereQuery, RawEvent, UserLocation, EventType, EventSource } from '../types/index.js';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';

function calculateDistance(coords1: number[], coords2: number[]): number {
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in km
  
  return distance;
}

class RecommendationEngine {
  async generateAndSendRecommendations() {
    try {
      await this.updateEventsDatabase();
      
      const users = await User.findAll();
      for (const user of users) {
        const recommendations = await this.getRecommendationsForUser(user);
        if (recommendations.length > 0) {
          await emailService.sendRecommendations(user.email, recommendations);
          await this.recordSentRecommendations(user.id, recommendations);
        }
      }
    } catch (error) {
      console.error('Error generating recommendations:', error);
    }
  }

  async updateEventsDatabase() {
    await Event.update(
      { is_active: false },
      {
        where: {
          recurring: false,
          'datetime.end': { [Op.lt]: new Date() }
        }
      }
    );

    const locations = await this.getUniqueUserLocations();
    
    for (const location of locations) {
      const concerts = await scraper.scrapeEventbrite({ coordinates: location, type: 'Point' }) as RawEvent[];
      const bars = await scraper.scrapeYelp({ coordinates: location, type: 'Point' }, ['cocktailbars']) as RawEvent[];

      for (const event of concerts) {
        const [existingEvent] = await Event.findOrCreate({
          where: {
            source: 'eventbrite',
            source_url: event.sourceUrl
          },
          defaults: {
            title: event.title,
            description: event.description,
            source: 'eventbrite',
            source_url: event.sourceUrl,
            type: 'concert',
            price: {
              min: event.price.min ?? 0,
              max: event.price.max ?? 0
            },
            location: {
              type: 'Point',
              coordinates: event.location.coordinates,
              address: event.location.address
            },
            datetime: event.datetime,
            is_active: true,
            recurring: event.recurring ?? false,
            recurrence_pattern: event.recurrencePattern,
            last_checked: new Date()
          }
        });

        if (existingEvent) {
          await existingEvent.update({
            title: event.title,
            description: event.description,
            price: {
              min: event.price.min ?? 0,
              max: event.price.max ?? 0
            },
            location: {
              type: 'Point',
              coordinates: event.location.coordinates,
              address: event.location.address
            },
            datetime: event.datetime,
            is_active: true,
            recurring: event.recurring ?? false,
            recurrence_pattern: event.recurrencePattern,
            last_checked: new Date()
          });
        }
      }

      for (const event of bars) {
        const [existingEvent] = await Event.findOrCreate({
          where: {
            source: 'yelp',
            source_url: event.sourceUrl
          },
          defaults: {
            title: event.title,
            description: event.description,
            source: 'yelp',
            source_url: event.sourceUrl,
            type: 'bar',
            price: {
              min: event.price.min ?? 0,
              max: event.price.max ?? 0
            },
            location: {
              type: 'Point',
              coordinates: event.location.coordinates,
              address: event.location.address
            },
            datetime: event.datetime,
            is_active: true,
            recurring: event.recurring ?? false,
            recurrence_pattern: event.recurrencePattern,
            last_checked: new Date()
          }
        });

        if (existingEvent) {
          await existingEvent.update({
            title: event.title,
            description: event.description,
            price: {
              min: event.price.min ?? 0,
              max: event.price.max ?? 0
            },
            location: {
              type: 'Point',
              coordinates: event.location.coordinates,
              address: event.location.address
            },
            datetime: event.datetime,
            is_active: true,
            recurring: event.recurring ?? false,
            recurrence_pattern: event.recurrencePattern,
            last_checked: new Date()
          });
        }
      }
    }
  }

  async getRecommendationsForUser(user: User) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const currentDayOfWeek = now.getDay();

    // Get events sent to this user in the last week
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const recentlyRecommendedEventIds = await UserEventRecommendation.findAll({
      where: {
        user_id: user.id,
        sent_at: {
          [Op.gte]: oneWeekAgo
        }
      },
      attributes: ['event_id']
    }).then(recommendations => recommendations.map(rec => rec.event_id));

    const where: WhereQuery = {
      is_active: true,
      id: {
        [Op.notIn]: recentlyRecommendedEventIds
      },
      [Op.or]: [
        {
          recurring: false,
          'datetime.start': { 
            [Op.gte]: new Date(now.getTime() - 3600000),
            [Op.lt]: tomorrow 
          }
        },
        {
          recurring: true
        }
      ]
    };

    const typeFilters: EventType[] = [];
    if (user.preferences.cocktailBars) typeFilters.push('bar');
    if (user.preferences.concerts) typeFilters.push('concert');
    if (user.preferences.painting) typeFilters.push('art');
    if (typeFilters.length > 0) {
      where.type = { [Op.in]: typeFilters };
    }

    // Get all potential events
    const events = await Event.findAll({
      where: where,
      order: sequelize.random()
    });

    // Filter and sort events by distance and price range
    const maxDistance = user.preferences.maxDistance; // in kilometers
    const userCoords = user.location.coordinates;
    const maxBudget = user.preferences.priceRange.max;
    
    const validEvents = events.filter(event => {
      // Skip events with invalid coordinates
      if (!event.location.coordinates || 
          (event.location.coordinates[0] === 0 && event.location.coordinates[1] === 0)) {
        return false;
      }

      // Check if event is within max distance
      const distance = calculateDistance(userCoords, event.location.coordinates);
      if (distance > maxDistance) {
        return false;
      }

      // Check if event price is within budget
      if (event.price?.max && event.price.max > maxBudget) {
        return false;
      }

      // For recurring events, check if it's happening today
      if (event.recurring) {
        if (!event.recurrence_pattern?.dayOfWeek) return false;
        return event.recurrence_pattern.dayOfWeek.includes(currentDayOfWeek);
      }

      return true;
    });

    // Sort events by a combination of distance and price match
    const sortedEvents = validEvents.sort((a, b) => {
      const distanceA = calculateDistance(userCoords, a.location.coordinates);
      const distanceB = calculateDistance(userCoords, b.location.coordinates);
      
      // Normalize distances and prices to 0-1 range
      const normalizedDistanceA = distanceA / maxDistance;
      const normalizedDistanceB = distanceB / maxDistance;
      
      const priceA = a.price?.max || 0;
      const priceB = b.price?.max || 0;
      const normalizedPriceA = priceA / maxBudget;
      const normalizedPriceB = priceB / maxBudget;
      
      // Combined score (70% distance, 30% price)
      const scoreA = (normalizedDistanceA * 0.7) + (normalizedPriceA * 0.3);
      const scoreB = (normalizedDistanceB * 0.7) + (normalizedPriceB * 0.3);
      
      return scoreA - scoreB;
    });

    // Return top 3 recommendations
    const recommendations = sortedEvents.slice(0, 3);
    
    console.log(`Found ${recommendations.length} matching events across different price ranges`);
    return recommendations;
  }

  async recordSentRecommendations(userId: number, events: Event[]) {
    const recommendations = events.map(event => ({
      user_id: userId,
      event_id: event.id,
      sent_at: new Date()
    }));

    await UserEventRecommendation.bulkCreate(recommendations);
  }

  async getUniqueUserLocations(): Promise<number[][]> {
    const users = await User.findAll({
      attributes: ['location'],
      group: ['location']
    });
    return users.map(user => user.location.coordinates);
  }
}

export default new RecommendationEngine(); 