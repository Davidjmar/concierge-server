'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_event_recommendations', 'google_calendar_event_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn('user_event_recommendations', 'proposed_at', {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: Sequelize.literal('NOW()'),
    });

    await queryInterface.addColumn('user_event_recommendations', 'user_response', {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: 'pending',
    });

    await queryInterface.addColumn('user_event_recommendations', 'response_detected_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn('user_event_recommendations', 'proposal_score', {
      type: Sequelize.FLOAT,
      allowNull: true,
    });

    // Index for polling pending proposals
    await queryInterface.addIndex('user_event_recommendations', ['user_response'], {
      name: 'uer_user_response_idx',
    });

    await queryInterface.addIndex('user_event_recommendations', ['google_calendar_event_id'], {
      name: 'uer_gcal_event_id_idx',
      where: { google_calendar_event_id: { [Sequelize.Op.ne]: null } },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('user_event_recommendations', 'uer_user_response_idx');
    await queryInterface.removeIndex('user_event_recommendations', 'uer_gcal_event_id_idx');
    const cols = [
      'google_calendar_event_id', 'proposed_at', 'user_response',
      'response_detected_at', 'proposal_score',
    ];
    for (const col of cols) {
      await queryInterface.removeColumn('user_event_recommendations', col);
    }
  },
};
