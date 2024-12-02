require('dotenv').config();
const { connectDB } = require('./src/utils/mongoUtils');
const App = require('./src/models/App');
const colors = require('colors');

async function updateIntegrationFlags() {
  try {
    // Connect to MongoDB
    await connectDB();
    console.log('MongoDB connected successfully'.green);

    // Find all relevant apps with no interactions
    const appsToUpdate = await App.find({
      isRelevant: true,
      $expr: { $eq: [{ $size: "$interactions" }, 0] }
    });

    console.log(`Found ${appsToUpdate.length} relevant apps with no interactions`.yellow);

    if (appsToUpdate.length === 0) {
      console.log('No apps need updating'.cyan);
      process.exit(0);
    }

    // Update all matching records
    const result = await App.updateMany(
      {
        isRelevant: true,
        $expr: { $eq: [{ $size: "$interactions" }, 0] }
      },
      {
        $set: { 
          hasZapierIntegration: false,
          isRelevant: false
        }
      }
    );

    console.log(`Successfully updated ${result.modifiedCount} apps`.green);
    console.log('Update summary:'.cyan);
    console.log('Modified count:', result.modifiedCount);
    console.log('Matched count:', result.matchedCount);

    // Log some sample apps that were updated
    const sampleUpdated = await App.find(
      { hasZapierIntegration: false }
    ).limit(5);

    if (sampleUpdated.length > 0) {
      console.log('\nSample updated apps:'.yellow);
      sampleUpdated.forEach(app => {
        console.log(`- ${app.title} (interactions: ${app.interactions.length})`.gray);
      });
    }

    process.exit(0);

  } catch (error) {
    console.error('Error updating integration flags:'.red, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nGracefully shutting down...'.yellow);
  process.exit(0);
});

// Run the update
updateIntegrationFlags();