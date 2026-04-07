'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // F1: Enhanced pass feedback columns
    await queryInterface.addColumn('user_event_recommendations', 'pass_reason', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });

    await queryInterface.addColumn('user_event_recommendations', 're_search_hint', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('user_event_recommendations', 'needs_replacement', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // F3: Add 'edmtrain' to the events source enum
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_events_source" ADD VALUE IF NOT EXISTS 'edmtrain'`
    );
  },

  async down(queryInterface) {
    const cols = ['pass_reason', 're_search_hint', 'needs_replacement'];
    for (const col of cols) {
      await queryInterface.removeColumn('user_event_recommendations', col);
    }
    // Note: Postgres does not support removing enum values without recreating the type.
  },
};
