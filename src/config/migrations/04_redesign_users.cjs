'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add Google OAuth columns
    await queryInterface.addColumn('users', 'name', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'google_id', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true,
    });

    await queryInterface.addColumn('users', 'google_access_token', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'google_refresh_token', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'google_calendar_id', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'primary',
    });

    // Structured location fields
    await queryInterface.addColumn('users', 'home_location', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'work_location', {
      type: Sequelize.JSONB,
      allowNull: true,
    });

    // Recommendation schedule settings
    await queryInterface.addColumn('users', 'recommendation_frequency', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'weekly',
    });

    await queryInterface.addColumn('users', 'recommendation_days', {
      type: Sequelize.ARRAY(Sequelize.TEXT),
      allowNull: true,
      defaultValue: ['monday'],
    });

    await queryInterface.addColumn('users', 'recommendation_time', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'morning',
    });

    await queryInterface.addColumn('users', 'max_proposals_per_run', {
      type: Sequelize.INTEGER,
      allowNull: true,
      defaultValue: 3,
    });

    await queryInterface.addColumn('users', 'city', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'denver',
    });

    // Feedback / interest matrix
    await queryInterface.addColumn('users', 'interest_matrix', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: { tag_weights: {}, venue_history: {}, last_updated: new Date().toISOString() },
    });

    await queryInterface.addColumn('users', 'onboarding_complete', {
      type: Sequelize.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    });

    // Add index on google_id
    await queryInterface.addIndex('users', ['google_id'], {
      unique: true,
      name: 'users_google_id_idx',
      where: { google_id: { [Sequelize.Op.ne]: null } },
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('users', 'users_google_id_idx');
    const cols = [
      'name', 'google_id', 'google_access_token', 'google_refresh_token',
      'google_calendar_id', 'home_location', 'work_location',
      'recommendation_frequency', 'recommendation_days', 'recommendation_time',
      'max_proposals_per_run', 'city', 'interest_matrix', 'onboarding_complete',
    ];
    for (const col of cols) {
      await queryInterface.removeColumn('users', col);
    }
  },
};
