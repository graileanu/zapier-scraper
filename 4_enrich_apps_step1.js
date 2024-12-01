// src/processApps.js
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { connectDB } = require('./src/utils/mongoUtils');
const App = require('./src/models/App');
const openAIService = require('./src/services/openaiService');
const RedisService = require('./src/services/redisService');
const colors = require('colors');

// Get machine ID from env or hostname
const MACHINE_ID = process.env.MACHINE_ID || os.hostname().split('.')[0];

// Initialize Redis Service
const redisService = new RedisService(MACHINE_ID);

async function processApp(appName) {
  try {
    // Check if app already exists in MongoDB
    const existingApp = await App.findOne({ slug: appName.toLowerCase() });
    if (existingApp) {
      console.log(`App ${appName} already exists, skipping...`);
      return;
    }

    // Fetch data from Redis
    const redisKey = `app:data:${appName}`;
    const appData = await redisService.client.get(redisKey);
    if (!appData) {
      console.log(`No Redis data found for ${appName}`);
      return;
    }

    // Normalize data using OpenAI
    const normalizedData = await openAIService.normalizeAppData(JSON.parse(appData));

    // Create new MongoDB document
    const app = new App({
      ...normalizedData,
      slug: appName.toLowerCase(),
      updatedAt: new Date()
    });

    // Save to MongoDB
    await app.save();
    console.log(`Successfully processed and saved ${appName.green}`);

  } catch (error) {
    console.error(`Error processing ${appName.red}:`, error);
  }
}

async function main() {
  try {
    // Check Redis connection
    if (!await redisService.isConnected()) {
      console.error('Redis connection failed. Exiting...'.red);
      process.exit(1);
    }

    // Connect to MongoDB
    await connectDB();
    console.log('MongoDB connected successfully'.green);

    // Read all files from lock directory
    const lockDir = path.join(process.cwd(), 'lock');
    const files = await fs.readdir(lockDir);
    const lockFiles = files.filter(file => file.endsWith('.lock'));

    console.log(`Found ${lockFiles.length} apps to process`.yellow);

    // Process each app
    for (const file of lockFiles) {
      const appName = file.replace('.lock', '');
      await processApp(appName);
    }

    console.log('Processing complete'.green);
    process.exit(0);
  } catch (error) {
    console.error('Main process error:'.red, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...'.yellow);
  process.exit(0);
});

main();
