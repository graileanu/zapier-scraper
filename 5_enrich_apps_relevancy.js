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
    const normalizedAppName = appName.toLowerCase();

    // Check if app already exists in MongoDB
    const existingApp = await App.findOne({ slug: normalizedAppName });
    if (existingApp) {
      console.log(`${appName} already exists in MongoDB, skipping...`.cyan);
      return;
    }

    // Check Redis status - using new key format for completion check
    const [processing, completed] = await Promise.all([
      redisService.client.get(`app:processing:${normalizedAppName}`),
      redisService.client.exists(`app:mongo:${normalizedAppName}`)
    ]);

    if (processing) {
      console.log(`${appName} is being processed by another machine, skipping...`.yellow);
      return;
    }

    if (completed) {
      console.log(`${appName} already processed to MongoDB, skipping...`.cyan);
      return;
    }

    // Mark as processing before starting
    await redisService.markAppProcessing(normalizedAppName);
    console.log(`Started processing ${appName}`.green);

    try {
      // Fetch data from Redis
      const redisKey = `app:data:${normalizedAppName}`;
      const appData = await redisService.client.get(redisKey);
      if (!appData) {
        console.log(`No Redis data found for ${appName}`.red);
        return;
      }

      // Normalize data using OpenAI
      const normalizedData = await openAIService.normalizeAppData(JSON.parse(appData));

      // Create new MongoDB document
      const app = new App({
        ...normalizedData,
        slug: normalizedAppName,
        updatedAt: new Date()
      });

      // Save to MongoDB
      await app.save();
      
      // Mark as completed in Redis with new key format
      const multi = redisService.client.multi();
      multi.set(`app:mongo:${normalizedAppName}`, JSON.stringify({
        processed_by: redisService.machineId,
        processed_at: Date.now()
      }));
      multi.del(`app:processing:${normalizedAppName}`);
      await multi.exec();

      console.log(`Successfully processed and saved ${appName}`.green);

    } catch (error) {
      console.error(`Error processing ${appName}`.red, error);
      // Remove processing flag on error
      await redisService.client.del(`app:processing:${normalizedAppName}`);
    }

  } catch (error) {
    console.error(`Error in processApp for ${appName}`.red, error);
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
