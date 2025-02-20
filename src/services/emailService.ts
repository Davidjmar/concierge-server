import { Resend } from 'resend';
import Event from '../models/event.js';

class EmailService {
  private resend: Resend | null = null;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('RESEND_API_KEY not found in environment variables. Email sending will be disabled.');
      return;
    }
    try {
      this.resend = new Resend(apiKey);
      console.log('Resend email service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Resend:', error);
      this.resend = null;
    }
  }

  async sendRecommendations(userEmail: string, recommendations: Event[]) {
    try {
      if (!this.resend) {
        console.warn('Email service not properly initialized. Skipping email send.');
        return { success: false, error: 'Email service not configured' };
      }

      if (recommendations.length === 0) {
        console.log(`No recommendations to send to ${userEmail}`);
        return { success: true, sent: 0 };
      }

      const htmlContent = this.generateEmailContent(recommendations);
      
      console.log(`Attempting to send email to ${userEmail} with ${recommendations.length} recommendations`);
      await this.resend.emails.send({
        from: 'Concierge <onboarding@resend.dev>',
        to: userEmail,
        subject: 'Your Daily Activity Recommendations',
        html: htmlContent
      });

      console.log(`Successfully sent recommendations to ${userEmail}`);
      return { success: true, sent: recommendations.length };
    } catch (error: any) {
      console.error('Error sending recommendations:', error);
      return { success: false, error: error?.message || 'Unknown error occurred' };
    }
  }

  private generateEmailContent(recommendations: Event[]): string {
    const eventsHtml = recommendations.map(event => `
      <div style="margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
        <h2 style="color: #333;">${event.title}</h2>
        <p style="color: #666;">${event.description || 'No description available'}</p>
        <p>
          <strong>When:</strong> ${new Date(event.datetime.start).toLocaleString()}<br>
          <strong>Type:</strong> ${event.type}<br>
          <strong>Price:</strong> ${event.price ? `$${event.price.min} - $${event.price.max}` : 'Free'}<br>
          <strong>Location:</strong> ${event.location.address || 'Address not available'}
        </p>
        ${event.source_url ? `<a href="${event.source_url}" style="color: #007bff;">More Info</a>` : ''}
      </div>
    `).join('');

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333; text-align: center;">Your Daily Recommendations</h1>
        ${eventsHtml}
        <div style="text-align: center; margin-top: 20px; color: #666;">
          <p>These recommendations are based on your preferences.</p>
        </div>
      </div>
    `;
  }
}

export default new EmailService(); 