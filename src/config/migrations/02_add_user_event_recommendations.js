export async function up(queryInterface, Sequelize) {
  await queryInterface.createTable('user_event_recommendations', {
    id: {
      type: Sequelize.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    event_id: {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: 'events',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    sent_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.NOW
    },
    created_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.NOW
    },
    updated_at: {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.NOW
    }
  });

  // Add indexes for performance
  await queryInterface.addIndex('user_event_recommendations', ['user_id', 'sent_at']);
  await queryInterface.addIndex('user_event_recommendations', ['user_id', 'event_id', 'sent_at']);
}

export async function down(queryInterface, Sequelize) {
  await queryInterface.dropTable('user_event_recommendations');
} 