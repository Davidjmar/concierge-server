export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('users', {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    email: {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true,
    },
    preferences: {
      type: Sequelize.JSONB,
      allowNull: false,
    },
    location: {
      type: Sequelize.JSONB,
      allowNull: false,
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });

  await queryInterface.createTable('events', {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    title: {
      type: Sequelize.STRING,
      allowNull: false,
    },
    description: {
      type: Sequelize.TEXT,
    },
    source: {
      type: Sequelize.ENUM('eventbrite', 'yelp', 'reddit', 'local_blog'),
      allowNull: false,
    },
    source_url: {
      type: Sequelize.STRING,
    },
    type: {
      type: Sequelize.ENUM('concert', 'bar', 'restaurant', 'art', 'sports', 'social'),
      allowNull: false,
    },
    price: {
      type: Sequelize.JSONB,
    },
    location: {
      type: Sequelize.JSONB,
      allowNull: false,
    },
    datetime: {
      type: Sequelize.JSONB,
      allowNull: false,
    },
    is_active: {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    recurring: {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
    },
    recurrence_pattern: {
      type: Sequelize.JSONB,
    },
    last_checked: {
      type: Sequelize.DATE,
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
    },
  });

  // Add indexes
  await queryInterface.addIndex('users', ['email'], { unique: true });
  await queryInterface.addIndex('events', ['is_active']);
  await queryInterface.addIndex('events', ['type']);
  await queryInterface.addIndex('events', ['source', 'source_url'], {
    unique: true,
    where: {
      source_url: {
        [Symbol.for('ne')]: null,
      },
    },
  });
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.dropTable('events');
  await queryInterface.dropTable('users');
} 