const redisClient = require('../utils/redisClient');

const PROCESSING_EXPIRY = 3600; // 1 hour in seconds
const STATUS_EXPIRY = 90; // 1.5 minutes in seconds

class RedisService {
  constructor(machineId) {
    this.machineId = machineId;
  }

  async checkAppStatus(appName) {
    const [processing, completed] = await Promise.all([
      redisClient.get(`app:processing:${appName}`),
      redisClient.exists(`app:data:${appName}`)
    ]);
    
    return {
      isProcessing: Boolean(processing),
      isCompleted: Boolean(completed)
    };
  }

  async markAppProcessing(appName) {
    const processingKey = `app:processing:${appName}`;
    await redisClient.set(processingKey, JSON.stringify({
      machine_id: this.machineId,
      started_at: Date.now()
    }), 'EX', PROCESSING_EXPIRY);
  }

  async markAppCompleted(appName, data) {
    const multi = redisClient.multi();
    
    // Store the app data
    multi.set(`app:data:${appName}`, JSON.stringify({
      ...data,
      processed_by: this.machineId,
      processed_at: Date.now()
    }));
    
    // Remove the processing status
    multi.del(`app:processing:${appName}`);
    
    await multi.exec();
  }

  async updateMachineStatus(status) {
    const statusKey = `status:${this.machineId}`;
    await redisClient.set(statusKey, JSON.stringify({
      ...status,
      last_update: Date.now()
    }), 'EX', STATUS_EXPIRY);
  }

  async getMachineStatus() {
    const statusKey = `status:${this.machineId}`;
    const status = await redisClient.get(statusKey);
    return status ? JSON.parse(status) : null;
  }

  async cleanup() {
    const statusKey = `status:${this.machineId}`;
    await redisClient.del(statusKey);
  }
}

module.exports = RedisService;
