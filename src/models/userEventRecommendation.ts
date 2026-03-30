import sequelize from '../config/database.js';
import pkg from 'sequelize';
const { Model, DataTypes } = pkg;
import User from './user.js';
import Event from './event.js';
import { UserResponse } from '../types/index.js';

class UserEventRecommendation extends Model {
  declare id: number;
  declare user_id: number;
  declare event_id: number;
  declare sent_at: Date;

  // Phase 2 additions
  declare google_calendar_event_id?: string;
  declare proposed_at?: Date;
  declare user_response?: UserResponse;
  declare response_detected_at?: Date;
  declare proposal_score?: number;
}

UserEventRecommendation.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: User, key: 'id' },
    },
    event_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: Event, key: 'id' },
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    google_calendar_event_id: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    proposed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    user_response: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: 'pending',
    },
    response_detected_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    proposal_score: {
      type: DataTypes.FLOAT,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'UserEventRecommendation',
    tableName: 'user_event_recommendations',
    underscored: true,
    indexes: [
      { fields: ['user_id', 'sent_at'] },
      { fields: ['user_id', 'event_id', 'sent_at'] },
      { fields: ['user_response'] },
    ],
  }
);

User.hasMany(UserEventRecommendation);
UserEventRecommendation.belongsTo(User);
Event.hasMany(UserEventRecommendation);
UserEventRecommendation.belongsTo(Event);

export default UserEventRecommendation;
