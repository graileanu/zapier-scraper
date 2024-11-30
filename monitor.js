const Redis = require('ioredis');
const Table = require('cli-table3');
const colors = require('colors/safe');
require('dotenv').config();

// Create Redis client with proper configuration
const redis = new Redis(process.env.REDIS_URL, {
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: null, // Important for long-running monitor
  enableReadyCheck: true,
  autoResubscribe: true,
  autoResendUnfulfilledCommands: true,
  connectTimeout: 20000,
  keepAlive: 30000,
  family: 4,
  tls: {
    rejectUnauthorized: false
  }
});

// Add Redis event handlers
redis.on('error', (error) => {
  console.error(colors.red('Redis error:'), error);
});

redis.on('connect', () => {
  const obfuscatedUrl = process.env.REDIS_URL.replace(/\/\/(.+?)@/, '//****:****@');
  console.log(colors.green(`Connected to Redis at ${obfuscatedUrl}`));
});

redis.on('ready', () => {
  console.log(colors.green('Redis client is ready'));
});

redis.on('close', () => {
  console.log(colors.yellow('Redis connection closed'));
});

redis.on('reconnecting', (ms) => {
  console.log(colors.yellow(`Reconnecting to Redis in ${ms}ms`));
});

// Rest of the monitoring code remains the same
const MACHINE_INACTIVE_THRESHOLD = 90000; // 1.5 minutes in ms
const REFRESH_INTERVAL = 5000; // 5 seconds

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

async function getMachineStats() {
  try {
    // Get all machine statuses
    const machineKeys = await redis.keys('machine:status:*');
    const machines = await Promise.all(
      machineKeys.map(async (key) => {
        const data = await redis.get(key);
        return { key, data: JSON.parse(data) };
      })
    );

    // Get processing and completed counts
    const [processingKeys, completedKeys] = await Promise.all([
      redis.keys('app:processing:*'),
      redis.keys('app:data:*')
    ]);

    return {
      machines,
      totalProcessing: processingKeys.length,
      totalCompleted: completedKeys.length
    };
  } catch (error) {
    console.error(colors.red('Error fetching stats:'), error);
    return null;
  }
}

let isShuttingDown = false;

async function displayStats() {
  if (isShuttingDown) return;
  
  try {
    const stats = await getMachineStats();
    if (!stats) {
      console.log(colors.yellow('Waiting for data...'));
      return;
    }

    process.stdout.write('\x1Bc');
    console.log(colors.cyan('\nZapier Apps Scraper Monitor\n'));

    // Machine Status Table
    const table = new Table({
      head: [
        colors.yellow('Machine'),
        colors.yellow('Status'),
        colors.yellow('Current App'),
        colors.yellow('Category'),
        colors.yellow('Processed'),
        colors.yellow('Failed'),
        colors.yellow('Last Active'),
        colors.yellow('Uptime')
      ]
    });

    const now = Date.now();
    stats.machines.forEach(({ key, data }) => {
      const machineId = key.replace('machine:status:', '');
      const lastActiveAgo = now - data.last_active;
      const isActive = lastActiveAgo < MACHINE_INACTIVE_THRESHOLD;
      const status = isActive ? colors.green('●') : colors.red('○');
      const uptime = formatDuration(now - data.started_at);

      table.push([
        machineId,
        status,
        data.current_app || '-',
        data.current_category || '-',
        data.processed_count,
        data.failed_count,
        formatDuration(lastActiveAgo) + ' ago',
        uptime
      ]);
    });

    console.log(table.toString());
    console.log('\nOverall Progress:');
    console.log(colors.cyan(`Total Apps Completed: ${stats.totalCompleted}`));
    console.log(colors.yellow(`Currently Processing: ${stats.totalProcessing}`));

    if (stats.totalProcessing > 0) {
      console.log('\nCurrently Processing Apps:');
      const processingApps = await redis.keys('app:processing:*');
      for (const key of processingApps) {
        const data = JSON.parse(await redis.get(key));
        const appName = key.replace('app:processing:', '');
        const duration = formatDuration(now - data.started_at);
        console.log(colors.gray(`- ${appName} (by ${data.machine_id}, running for ${duration})`));
      }
    }
  } catch (error) {
    console.error(colors.red('Error in monitor:'), error);
  }
}

// Start monitoring
console.log(colors.cyan('Starting monitor...'));
displayStats();
const intervalId = setInterval(displayStats, REFRESH_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', async () => {
  isShuttingDown = true;
  clearInterval(intervalId);
  console.log(colors.yellow('\nShutting down monitor...'));
  await redis.quit();
  process.exit(0);
});