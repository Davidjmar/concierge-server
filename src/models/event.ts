import sequelize from '../config/database.js';
import pkg from 'sequelize';
const { Model, DataTypes } = pkg;
import {
  EventSource,
  EventType,
  EventPrice,
  EventLocation,
  EventDatetime,
  RecurrencePattern,
  HappyHourSchedule,
  ExternalIds,
} from '../types/index.js';

class Event extends Model {
  declare id: number;
  declare title: string;
  declare description?: string;
  declare source: EventSource;
  declare source_url?: string;
  declare type: EventType;
  declare price?: EventPrice;
  declare location: EventLocation;
  declare datetime: EventDatetime;
  declare is_active: boolean;
  declare recurring?: boolean;
  declare recurrence_pattern?: RecurrencePattern;
  declare last_checked?: Date;

  // Phase 1 additions
  declare city: string;
  declare neighborhood?: string;
  declare venue_name?: string;
  declare tags?: string[];
  declare happy_hour_schedule?: HappyHourSchedule;
  declare external_ids?: ExternalIds;
  declare image_url?: string;
}

Event.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    source: {
      type: DataTypes.ENUM(
        'eventbrite',
        'yelp',
        'goldenbuzz',
        'westword',
        'google_sheets',
        'denver_gov',
        'manual',
        'reddit',
        'local_blog'
      ),
      allowNull: false,
    },
    source_url: {
      type: DataTypes.STRING,
    },
    type: {
      type: DataTypes.ENUM(
        'concert',
        'bar',
        'restaurant',
        'art',
        'sports',
        'social',
        'festival',
        'class',
        'comedy',
        'trivia',
        'film',
        'market',
        'park'
      ),
      allowNull: false,
    },
    price: {
      type: DataTypes.JSONB,
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    datetime: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    recurring: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    recurrence_pattern: {
      type: DataTypes.JSONB,
    },
    last_checked: {
      type: DataTypes.DATE,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'denver',
    },
    neighborhood: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    venue_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: true,
      defaultValue: [],
    },
    happy_hour_schedule: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    external_ids: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    image_url: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'Event',
    tableName: 'events',
    underscored: true,
    indexes: [
      {
        fields: ['is_active'],
      },
      {
        fields: ['type'],
      },
      {
        fields: ['city'],
      },
      {
        fields: ['source', 'source_url'],
        unique: true,
        where: {
          source_url: {
            [Symbol.for('ne')]: null,
          },
        },
      },
    ],
  }
);

export default Event;
