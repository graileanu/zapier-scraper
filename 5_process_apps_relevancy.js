require('dotenv').config();
const { connectDB } = require('./src/utils/mongoUtils');
const App = require('./src/models/App');
const openAIService = require('./src/services/openaiService');
const RedisService = require('./src/services/redisService');
const os = require('os');
const colors = require('colors');

// Get machine ID from env or hostname
const MACHINE_ID = process.env.MACHINE_ID || os.hostname().split('.')[0];

// Initialize Redis Service
const redisService = new RedisService(MACHINE_ID);

// Add machine status tracking
const machineStatus = {
  machine_id: MACHINE_ID,
  started_at: Date.now(),
  last_active: Date.now(),
  processed_count: 0,
  failed_count: 0,
  current_app: null
};

async function processApp(app) {
  const normalizedAppName = app.slug;
  machineStatus.current_app = app.title;

  try {
    // Check if app is already being processed or completed
    const { isProcessing, isCompleted } = await redisService.checkRelevancyStatus(normalizedAppName);
    
    if (isProcessing) {
      console.log(`${app.title} is being analyzed by another machine, skipping...`.yellow);
      return;
    }

    if (isCompleted) {
      console.log(`${app.title} already analyzed, skipping...`.cyan);
      return;
    }

    // Mark as processing before starting
    await redisService.markRelevancyProcessing(normalizedAppName);
    console.log(`Started analyzing ${app.title}`.green);

    // Get relevancy analysis from OpenAI
    const analysis = await openAIService.analyzeAppRelevancy(
      app.title,
      app.description
    );

    // Update app record
    await App.findByIdAndUpdate(app._id, {
      isRelevant: analysis.isRelevant,
      relevancyReasoning: analysis.reasoning,
      potentialUseCase: analysis.potentialUseCase,
      updatedAt: new Date()
    });

    // Mark as completed in Redis
    await redisService.markRelevancyCompleted(normalizedAppName, {
      is_relevant: analysis.isRelevant,
      reasoning: analysis.reasoning
    });

    // Update machine status
    machineStatus.processed_count++;
    
    // Color-coded output based on relevancy
    const statusColor = analysis.isRelevant ? 'green' : 'yellow';
    console.log(`Successfully analyzed ${app.title}: ${analysis.isRelevant ? 'Relevant' : 'Not Relevant'}`[statusColor]);

  } catch (error) {
    console.error(`Error processing ${app.title}`.red, error);
    machineStatus.failed_count++;
    // Remove processing lock on error
    await redisService.clearRelevancyProcessing(normalizedAppName);
    throw error;
  } finally {
    machineStatus.current_app = null;
  }
}

// Update machine status periodically
setInterval(async () => {
  try {
    await redisService.updateMachineStatus(machineStatus);
  } catch (error) {
    console.error('Failed to update machine status:'.red, error);
  }
}, 30000);

async function processAppRelevancy() {
  try {
    // Check Redis connection
    if (!await redisService.isConnected()) {
      console.error('Redis connection failed. Exiting...'.red);
      process.exit(1);
    }

    // Connect to MongoDB
    await connectDB();
    console.log('MongoDB connected successfully'.green);

    // Find all apps without isRelevant flag
    const apps = await App.find({ isRelevant: null });
    console.log(`Found ${apps.length} apps to analyze for relevancy`.yellow);

    // Process each app
    for (const app of apps) {
      try {
        await processApp(app);
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error in main loop for ${app.title}`.red, error);
        continue; // Continue with next app even if one fails
      }
    }

    console.log('Relevancy analysis complete'.green);
    process.exit(0);
  } catch (error) {
    console.error('Main process error:'.red, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...'.yellow);
  try {
    await redisService.updateMachineStatus({
      ...machineStatus,
      status: 'stopped'
    });
  } catch (error) {
    console.error('Error updating final status:'.red, error);
  }
  process.exit(0);
});

processAppRelevancy();