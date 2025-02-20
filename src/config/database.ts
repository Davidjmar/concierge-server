import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

const isProduction = process.env.NODE_ENV === 'production';

// Parse the DATABASE_URL for Render deployment
let sequelizeConfig: any = {
  dialect: 'postgres',
  logging: false, // Set to console.log to see SQL queries
  define: {
    timestamps: true,
    underscored: true
  }
};

if (isProduction) {
  sequelizeConfig = {
    ...sequelizeConfig,
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  };
}

const sequelize = new Sequelize(databaseUrl, sequelizeConfig);

export default sequelize; 