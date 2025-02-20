import Event from '../models/event.js';

class EmailService {
  async sendRecommendations(userEmail: string, recommendations: Event[]) {
    // Mock implementation for testing
    console.log(`Sending recommendations to ${userEmail}`);
    return Promise.resolve({
      success: true,
      sent: recommendations.length
    });
  }
}

export default new EmailService(); 