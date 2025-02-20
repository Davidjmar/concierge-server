# Activity Recommender

An AI-powered activity recommendation service that sends personalized daily recommendations for events and activities.

## Features

- Daily event recommendations based on user preferences
- Support for various event types (concerts, bars, art exhibitions, etc.)
- Email notifications with personalized recommendations
- Automatic event scraping from multiple sources

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
- Copy `.env.example` to `.env`
- Update the variables with your values

3. Build the project:
```bash
npm run build
```

4. Start the server:
```bash
npm start
```

## Development

Run the development server with hot reload:
```bash
npm run dev
```

Run tests:
```bash
npm test
```

## Deployment

This project is configured for deployment on Render.com:

1. Push the code to GitHub
2. Create a new Web Service on Render
3. Connect to your GitHub repository
4. Configure the following:
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Environment Variables: Copy from `.env.example`

## License

MIT 