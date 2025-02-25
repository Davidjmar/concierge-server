import sequelize from '../config/database.js';
import pkg from 'sequelize';
const { Model, DataTypes } = pkg;
import User from './user.js';
import Event from './event.js';

class UserEventRecommendation extends Model {
  declare id: number;
  declare user_id: number;
  declare event_id: number;
  declare sent_at: Date;
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
      references: {
        model: User,
        key: 'id'
      }
    },
    event_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: Event,
        key: 'id'
      }
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    modelName: 'UserEventRecommendation',
    tableName: 'user_event_recommendations',
    underscored: true,
    indexes: [
      {
        // Index for querying recent recommendations for a user
        fields: ['user_id', 'sent_at']
      },
      {
        // Compound index for checking specific user-event combinations
        fields: ['user_id', 'event_id', 'sent_at']
      }
    ]
  }
);

// Set up associations
User.hasMany(UserEventRecommendation);
UserEventRecommendation.belongsTo(User);
Event.hasMany(UserEventRecommendation);
UserEventRecommendation.belongsTo(Event);

export default UserEventRecommendation; 