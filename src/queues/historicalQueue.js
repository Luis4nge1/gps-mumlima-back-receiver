import { Queue, Worker } from 'bullmq';
import redisClient from '../config/redis.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { decompressData } from '../utils/compression.js';
import redisIOClient from '../config/redisIO.js';

// Create historical queue
export const historicalQueue = new Queue(config.queue.name, {
  connection: redisIOClient,
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Create worker to process historical data
export const historicalWorker = new Worker(
  config.queue.name,
  async (job) => {
    try {
      const { deviceId, data, timestamp } = job.data;
      
      // Decompress the GPS data
      const buffer = Buffer.from(data, 'base64');
      const decompressedData = await decompressData(buffer);

      // Guardar en Redis como histórico (append)
      await redisIOClient.rpush(
        `gps:history:${deviceId}`,
        JSON.stringify(decompressedData)
      );

      // Guardar en Redis como última posición (sobrescribe)
      await redisIOClient.hset(
        `gps:last:${deviceId}`,
        {
          ...decompressedData,
          updatedAt: new Date().toISOString()
        }
      );
      
      logger.info('Processing historical GPS data', {
        jobId: job.id,
        deviceId,
        timestamp,
        decompressed: true
      });
      
      // Here you would typically save to a time-series database
      // For now, we'll just log the processed data
      logger.info('Historical GPS data processed', {
        jobId: job.id,
        deviceId,
        position: decompressedData,
        processedAt: new Date().toISOString()
      });
      
      return { success: true, deviceId, processedAt: new Date().toISOString() };
      
    } catch (error) {
      logger.error('Error processing historical GPS data', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  },
  {
    connection: redisIOClient,
    concurrency: config.queue.concurrency,
  }
);

// Event handlers
historicalQueue.on('completed', (job, result) => {
  logger.info('Historical job completed', {
    jobId: job.id,
    result
  });
});

historicalQueue.on('failed', (job, err) => {
  logger.error('Historical job failed', {
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade
  });
});

historicalWorker.on('completed', (job, result) => {
  logger.debug('Historical worker completed job', {
    jobId: job.id,
    result
  });
});

historicalWorker.on('failed', (job, err) => {
  logger.error('Historical worker failed', {
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade
  });
});

/**
 * Add GPS position to historical queue
 * @param {Object} data - GPS position data
 * @returns {Promise<Object>} Job information
 */
export const addToHistoricalQueue = async (data) => {
  try {
    const job = await historicalQueue.add('process-gps-historical', data, {
      priority: 1,
      delay: 0,
    });
    
    logger.debug('GPS position added to historical queue', {
      jobId: job.id,
      deviceId: data.deviceId,
      timestamp: data.timestamp
    });
    
    return job;
  } catch (error) {
    logger.error('Error adding to historical queue', {
      error: error.message,
      data
    });
    throw error;
  }
};

/**
 * Get queue statistics
 * @returns {Promise<Object>} Queue statistics
 */
export const getQueueStats = async () => {
  try {
    const waiting = await historicalQueue.getWaiting();
    const active = await historicalQueue.getActive();
    const completed = await historicalQueue.getCompleted();
    const failed = await historicalQueue.getFailed();
    
    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length
    };
  } catch (error) {
    logger.error('Error getting queue stats', { error: error.message });
    throw error;
  }
};