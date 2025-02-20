import express from 'express';
import cron from 'node-cron';
import dotenv from 'dotenv';

import apiRoutes from './routes/api.js';
import recommendationEngine from './services/recommendationEngine.js';
import initDatabase from './config/init.js';

dotenv.config();

const app = express();
app.use(express.json());

// Initialize database
await initDatabase();

// API routes
app.use('/api', apiRoutes);

// Schedule daily recommendation job
cron.schedule('0 16 * * *', async () => { // Runs at 4 PM every day
  await recommendationEngine.generateAndSendRecommendations();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 