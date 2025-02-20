import User from '../models/user.js';
import Event from '../models/event.js';
import scraper from './scraper.js';
import emailService from './emailService.js';
import { WhereQuery, RawEvent, UserLocation, EventType, EventSource } from '../types/index.js';
import { Op } from 'sequelize';

class RecommendationEngine {
  async generateAndSendRecommendations() {
    try {
      await this.updateEventsDatabase();
      
      const users = await User.findAll();
      for (const user of users) {
        const recommendations = await this.getRecommendationsForUser(user);
        if (recommendations.length > 0) {
          await emailService.sendRecommendations(user.email, recommendations);
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

    const where: WhereQuery = {
      is_active: true,
      'datetime.start': { 
        [Op.gte]: new Date(now.getTime() - 3600000),
        [Op.lt]: tomorrow 
      }
    };

    const typeFilters: EventType[] = [];
    if (user.preferences.concerts) typeFilters.push('concert');
    if (user.preferences.cocktailBars) typeFilters.push('bar');
    if (user.preferences.painting) typeFilters.push('art');
    if (typeFilters.length > 0) {
      where.type = { [Op.in]: typeFilters };
    }

    if (user.preferences.priceRange) {
      if (user.preferences.priceRange.min !== undefined) {
        where['price.min'] = { [Op.gte]: user.preferences.priceRange.min };
      }
      if (user.preferences.priceRange.max !== undefined) {
        where['price.max'] = { [Op.lte]: user.preferences.priceRange.max };
      }
    }

    const events = await Event.findAll({
      where,
      limit: 10,
      order: [
        ['datetime.start', 'ASC']
      ]
    });

    return events;
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