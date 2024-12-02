// cleanup-redis.js
require('dotenv').config();
const Redis = require('ioredis');
const redisClient = require('./src/utils/redisClient');

async function cleanupRedis() {
  try {
    console.log('Starting cleanup...');
    let totalDeleted = 0;

    // Function to scan and delete keys with a pattern
    async function deleteKeysWithPattern(pattern) {
      let cursor = '0';
      do {
        // Scan for keys in batches
        const [newCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
        cursor = newCursor;

        if (keys.length > 0) {
          // Delete found keys
          await redisClient.del(...keys);
          totalDeleted += keys.length;
          console.log(`Deleted batch of ${keys.length} keys`);
        }
      } while (cursor !== '0');
    }

    // Clean up data and processing keys
    await deleteKeysWithPattern('app:data:*');
    await deleteKeysWithPattern('app:processing:*');

    console.log(`Cleanup complete. Total keys deleted: ${totalDeleted}`);
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupRedis();
