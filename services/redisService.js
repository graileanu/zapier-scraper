const Redis = require('ioredis');
const redisClient = require('../utils/redisClient');

const PROCESSING_EXPIRY = 3600; // 1 hour in seconds
const STATUS_EXPIRY = 90; // 1.5 minutes in seconds

class RedisService {
  constructor(machineId) {
    this.machineId = machineId;
    this.client = redisClient;
  }

  async isConnected() {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      console.error('Redis connection check failed:', error);
      return false;
    }
  }

  async updateMachineStatus(status) {
    try {
      const key = `machine:status:${this.machineId}`;
      await this.client.set(key, JSON.stringify({
        ...status,
        last_active: Date.now()
      }), 'EX', STATUS_EXPIRY);
    } catch (error) {
      console.error(`Error updating machine status for ${this.machineId}:`, error);
      throw error;
    }
  }

  async checkAppStatus(appName) {
    try {
      const [processing, completed] = await Promise.all([
        this.client.get(`app:processing:${appName}`),
        this.client.exists(`app:data:${appName}`)
      ]);
      
      return {
        isProcessing: Boolean(processing),
        isCompleted: Boolean(completed)
      };
    } catch (error) {
      console.error(`Error checking app status for ${appName}:`, error);
      throw error;
    }
  }

  async markAppProcessing(appName) {
    try {
      const processingKey = `app:processing:${appName}`;
      await this.client.set(processingKey, JSON.stringify({
        machine_id: this.machineId,
        started_at: Date.now()
      }), 'EX', PROCESSING_EXPIRY);
    } catch (error) {
      console.error(`Error marking app as processing for ${appName}:`, error);
      throw error;
    }
  }

  async markAppCompleted(appName, data) {
    try {
      const multi = this.client.multi();
      
      multi.set(`app:data:${appName}`, JSON.stringify({
        ...data,
        processed_by: this.machineId,
        processed_at: Date.now()
      }));
      
      multi.del(`app:processing:${appName}`);
      
      await multi.exec();
    } catch (error) {
      console.error(`Error marking app as completed for ${appName}:`, error);
      throw error;
    }
  }
}

module.exports = RedisService;

