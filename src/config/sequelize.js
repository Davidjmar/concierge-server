export default {
  development: {
    url: process.env.DATABASE_URL || 'postgres://localhost:5432/activity_recommender',
    dialect: 'postgres',
    logging: false,
    define: {
      underscored: true,
      timestamps: true
    }
  },
  test: {
    url: process.env.DATABASE_URL || 'postgres://localhost:5432/activity_recommender_test',
    dialect: 'postgres',
    logging: false,
    define: {
      underscored: true,
      timestamps: true
    }
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    logging: false,
    define: {
      underscored: true,
      timestamps: true
    },
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
}; 