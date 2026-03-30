'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add new columns to events table
    await queryInterface.addColumn('events', 'city', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'denver',
    });

    await queryInterface.addColumn('events', 'neighborhood', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('events', 'venue_name', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('events', 'tags', {
      type: Sequelize.ARRAY(Sequelize.TEXT),
      allowNull: true,
      defaultValue: [],
    });

    await queryInterface.addColumn('events', 'happy_hour_schedule', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addColumn('events', 'external_ids', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: {},
    });

    await queryInterface.addColumn('events', 'image_url', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    // Expand source enum — Postgres requires dropping and recreating the type
    // Add new values to the existing source enum
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_source" ADD VALUE IF NOT EXISTS 'goldenbuzz';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_source" ADD VALUE IF NOT EXISTS 'westword';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_source" ADD VALUE IF NOT EXISTS 'denver_gov';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_source" ADD VALUE IF NOT EXISTS 'google_sheets';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_source" ADD VALUE IF NOT EXISTS 'manual';`
    );

    // Expand type enum
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'festival';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'class';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'comedy';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'trivia';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'film';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'market';`
    );
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_type" ADD VALUE IF NOT EXISTS 'park';`
    );

    // Add index on city for multi-city queries
    await queryInterface.addIndex('events', ['city'], { name: 'events_city_idx' });
    await queryInterface.addIndex('events', ['tags'], {
      name: 'events_tags_idx',
      using: 'gin',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('events', 'events_city_idx');
    await queryInterface.removeIndex('events', 'events_tags_idx');
    await queryInterface.removeColumn('events', 'city');
    await queryInterface.removeColumn('events', 'neighborhood');
    await queryInterface.removeColumn('events', 'venue_name');
    await queryInterface.removeColumn('events', 'tags');
    await queryInterface.removeColumn('events', 'happy_hour_schedule');
    await queryInterface.removeColumn('events', 'external_ids');
    await queryInterface.removeColumn('events', 'image_url');
    // Note: Postgres does not support removing enum values, so we leave the enum expansions
  },
};
