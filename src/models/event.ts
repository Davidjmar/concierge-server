import { Model, DataTypes, InferAttributes, InferCreationAttributes, CreationOptional } from 'sequelize';
import sequelize from '../config/database.js';

type EventSource = 'eventbrite' | 'yelp' | 'reddit' | 'local_blog';
type EventType = 'concert' | 'bar' | 'restaurant' | 'art' | 'sports' | 'social';

interface EventPrice {
  min?: number;
  max?: number;
}

interface EventLocation {
  type: string;
  coordinates: number[];
  address?: string;
}

interface EventDatetime {
  start: Date;
  end: Date;
}

interface RecurrencePattern {
  frequency: string;
  dayOfWeek: number[];
  dayOfMonth?: number;
}

class Event extends Model<InferAttributes<Event>, InferCreationAttributes<Event>> {
  declare id: CreationOptional<number>;
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
      type: DataTypes.ENUM('eventbrite', 'yelp', 'reddit', 'local_blog'),
      allowNull: false,
    },
    source_url: {
      type: DataTypes.STRING,
    },
    type: {
      type: DataTypes.ENUM('concert', 'bar', 'restaurant', 'art', 'sports', 'social'),
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