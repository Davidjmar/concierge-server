import sequelize from '../config/database.js';
import { UserPreferences, UserLocation } from '../types/index.js';
import pkg from 'sequelize';
const { Model, DataTypes } = pkg;

class User extends Model {
  declare id: number;
  declare email: string;
  declare preferences: UserPreferences;
  declare location: UserLocation;
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
      allowNull: false,
    },
    location: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    indexes: [
      {
        unique: true,
        fields: ['email'],
      },
    ],
  }
);

export default User; 