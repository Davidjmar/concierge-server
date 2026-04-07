import sequelize from '../config/database.js';
import { UserPreferences, UserPreferencesV2, UserLocation, GeoPoint, InterestMatrix } from '../types/index.js';
import pkg from 'sequelize';
const { Model, DataTypes } = pkg;

class User extends Model {
  declare id: number;
  declare email: string;

  // Legacy fields (kept for backwards compat during migration)
  declare preferences: UserPreferences | UserPreferencesV2;
  declare location: UserLocation | GeoPoint;

  // Identity
  declare name?: string;
  declare google_id?: string;
  declare google_access_token?: string;
  declare google_refresh_token?: string;
  declare google_calendar_id?: string;

  // Locations
  declare home_location?: GeoPoint;
  declare work_location?: GeoPoint;

  // Recommendation schedule
  declare recommendation_frequency?: 'daily' | '2x_week' | 'weekly';
  declare recommendation_days?: string[];
  declare recommendation_time?: 'morning' | 'midday';
  declare max_proposals_per_run?: number;
  declare city?: string;

  // Delivery timing preference
  declare delivery_timing?: string; // 'day_of' | 'sunday' | 'smart'

  // Feedback
  declare interest_matrix?: InterestMatrix;
  declare onboarding_complete?: boolean;
}

User.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    preferences: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    google_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    google_access_token: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    google_refresh_token: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    google_calendar_id: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'primary',
    },
    home_location: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    work_location: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    recommendation_frequency: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'weekly',
    },
    recommendation_days: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: true,
      defaultValue: ['monday'],
    },
    recommendation_time: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'morning',
    },
    max_proposals_per_run: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 3,
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'denver',
    },
    delivery_timing: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'day_of',
    },
    interest_matrix: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    onboarding_complete: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['email'],
      },
    ],
  }
);

export default User;
