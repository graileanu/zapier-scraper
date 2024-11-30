const Redis = require('ioredis');
const dotenv = require('dotenv');
dotenv.config();

const createRedisClient = () => {
  const client = new Redis(process.env.REDIS_URL, {
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      console.log(`Retrying Redis connection in ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    autoResubscribe: false,
    autoResendUnfulfilledCommands: false,
    lazyConnect: true,
    reconnectOnError: (err) => {
      console.error('Redis reconnect on error:', err);
      return true;
    },
    connectTimeout: 20000,
    keepAlive: 30000,
    family: 4,
    tls: {
      rejectUnauthorized: false
    }
  });

  client.on('error', (error) => {
    console.error('Redis error:', error);
  });

  client.on('connect', () => {
    const obfuscatedUrl = process.env.REDIS_URL.replace(/\/\/(.+?)@/, '//****:****@');
    console.log(`Connected to Redis at ${obfuscatedUrl}`);
  });

  client.on('ready', () => {
    console.log('Redis client is ready');
  });

  client.on('close', () => {
    console.warn('Redis connection closed');
  });

  client.on('reconnecting', (ms) => {
    console.log(`Reconnecting to Redis in ${ms}ms`);
  });

  return client;
};

const redisClient = createRedisClient();

redisClient.connect().catch((err) => {
  console.error('Failed to connect to Redis:', err);
});

module.exports = { createRedisClient, redisClient };
