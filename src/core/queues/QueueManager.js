import { Queue, Worker } from 'bullmq';
import logger from '../../utils/logger.js';
import config from '../../config/config.js';
import redisIOClient from '../../config/redisIO.js';
import RedisManager from '../storage/RedisManager.js';
import EventBus from '../events/EventBus.js';
import { compressData, decompressData } from '../../utils/compression.js';

/**
 * Gestor centralizado de colas para procesamiento de datos GPS
 * Maneja las colas de datos históricos y últimas posiciones
 */
class QueueManager {
  constructor() {
    this.queues = {};
    this.workers = {};
    this.isInitialized = false;
  }

  /**
   * Inicializa las colas y workers
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.createQueues();
      await this.createWorkers();
      this.setupEventHandlers();
      
      this.isInitialized = true;
      logger.info('QueueManager initialized successfully');
      
    } catch (error) {
      logger.error('Error initializing QueueManager', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Crea las colas necesarias
   */
  async createQueues() {
    // Cola para datos históricos
    this.queues.historical = new Queue('gps-historical-batch', {
      connection: redisIOClient,
      defaultJobOptions: {
        removeOnComplete: config.queue.historical.removeOnComplete || 100,
        removeOnFail: config.queue.historical.removeOnFail || 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    // Cola para últimas posiciones
    this.queues.latest = new Queue('gps-latest-batch', {
      connection: redisIOClient,
      defaultJobOptions: {
        removeOnComplete: config.queue.latest.removeOnComplete || 50,
        removeOnFail: config.queue.latest.removeOnFail || 25,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      },
    });

    logger.info('Queues created successfully');
  }

  /**
   * Crea los workers para procesar las colas
   */
  async createWorkers() {
    // Worker para datos históricos
    this.workers.historical = new Worker(
      'gps-historical-batch',
      async (job) => await this.processHistoricalJob(job),
      {
        connection: redisIOClient,
        concurrency: config.queue.historical.concurrency || 5,
      }
    );

    // Worker para últimas posiciones
    this.workers.latest = new Worker(
      'gps-latest-batch',
      async (job) => await this.processLatestJob(job),
      {
        connection: redisIOClient,
        concurrency: config.queue.latest.concurrency || 3,
      }
    );

    logger.info('Workers created successfully');
  }

  /**
   * Configura los manejadores de eventos
   */
  setupEventHandlers() {
    // Eventos de cola histórica
    this.queues.historical.on('completed', (job, result) => {
      logger.info('Historical batch job completed', {
        jobId: job.id,
        batchId: result.batchId,
        processedCount: result.processedCount
      });
      EventBus.emit('queue.historical.completed', { job, result });
    });

    this.queues.historical.on('failed', (job, err) => {
      logger.error('Historical batch job failed', {
        jobId: job.id,
        error: err.message,
        attempts: job.attemptsMade
      });
      EventBus.emit('queue.historical.failed', { job, error: err });
    });

    // Eventos de cola de últimas posiciones
    this.queues.latest.on('completed', (job, result) => {
      logger.info('Latest positions batch job completed', {
        jobId: job.id,
        batchId: result.batchId,
        processedCount: result.processedCount
      });
      EventBus.emit('queue.latest.completed', { job, result });
    });

    this.queues.latest.on('failed', (job, err) => {
      logger.error('Latest positions batch job failed', {
        jobId: job.id,
        error: err.message,
        attempts: job.attemptsMade
      });
      EventBus.emit('queue.latest.failed', { job, error: err });
    });

    // Eventos de workers
    this.workers.historical.on('completed', (job, result) => {
      logger.debug('Historical worker completed job', {
        jobId: job.id,
        batchId: result.batchId
      });
    });

    this.workers.latest.on('completed', (job, result) => {
      logger.debug('Latest worker completed job', {
        jobId: job.id,
        batchId: result.batchId
      });
    });
  }

  /**
   * Procesa un trabajo de lote histórico
   * @param {Object} job - Trabajo de BullMQ
   * @returns {Object} Resultado del procesamiento
   */
  async processHistoricalJob(job) {
    try {
      const { batchId, positions, count, createdAt } = job.data;

      logger.info('Processing historical GPS batch', {
        jobId: job.id,
        batchId,
        count,
        createdAt
      });

      // Comprimir datos antes de guardar
      const compressedData = await compressData(positions);
      
      // Guardar en Redis como historial global
      await RedisManager.saveHistoricalBatch({
        batchId,
        positions,
        compressedData,
        count,
        createdAt
      });

      const result = {
        success: true,
        batchId,
        processedCount: count,
        processedAt: new Date().toISOString()
      };

      EventBus.emit('batch.historical.processed', result);
      
      return result;

    } catch (error) {
      logger.error('Error processing historical GPS batch', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Procesa un trabajo de lote de últimas posiciones
   * @param {Object} job - Trabajo de BullMQ
   * @returns {Object} Resultado del procesamiento
   */
  async processLatestJob(job) {
    try {
      const { batchId, positions, deviceIds, count, createdAt } = job.data;

      logger.info('Processing latest GPS positions batch', {
        jobId: job.id,
        batchId,
        count,
        deviceCount: deviceIds.length,
        createdAt
      });

      // Guardar últimas posiciones en Redis (sin duplicados)
      await RedisManager.saveLatestPositions(positions);

      const result = {
        success: true,
        batchId,
        processedCount: count,
        deviceCount: deviceIds.length,
        processedAt: new Date().toISOString()
      };

      EventBus.emit('batch.latest.processed', result);
      
      return result;

    } catch (error) {
      logger.error('Error processing latest GPS positions batch', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Agrega un lote histórico a la cola
   * @param {Object} batchData - Datos del lote
   * @returns {Promise<Object>} Información del trabajo
   */
  async addHistoricalBatch(batchData) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const job = await this.queues.historical.add('process-historical-batch', batchData, {
        priority: 2, // Prioridad media
        delay: 0,
      });

      logger.debug('Historical batch added to queue', {
        jobId: job.id,
        batchId: batchData.batchId,
        count: batchData.count
      });

      return job;

    } catch (error) {
      logger.error('Error adding historical batch to queue', {
        error: error.message,
        batchData
      });
      throw error;
    }
  }

  /**
   * Agrega un lote de últimas posiciones a la cola
   * @param {Object} batchData - Datos del lote
   * @returns {Promise<Object>} Información del trabajo
   */
  async addLatestBatch(batchData) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const job = await this.queues.latest.add('process-latest-batch', batchData, {
        priority: 1, // Alta prioridad
        delay: 0,
      });

      logger.debug('Latest batch added to queue', {
        jobId: job.id,
        batchId: batchData.batchId,
        count: batchData.count
      });

      return job;

    } catch (error) {
      logger.error('Error adding latest batch to queue', {
        error: error.message,
        batchData
      });
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de las colas
   * @returns {Promise<Object>} Estadísticas
   */
  async getStats() {
    if (!this.isInitialized) {
      return { initialized: false };
    }

    try {
      const [historicalStats, latestStats] = await Promise.all([
        this.getQueueStats(this.queues.historical),
        this.getQueueStats(this.queues.latest)
      ]);

      return {
        initialized: true,
        historical: historicalStats,
        latest: latestStats
      };

    } catch (error) {
      logger.error('Error getting queue stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Obtiene estadísticas de una cola específica
   * @param {Queue} queue - Cola a consultar
   * @returns {Promise<Object>} Estadísticas
   */
  async getQueueStats(queue) {
    try {
      const waiting = await queue.getWaiting();
      const active = await queue.getActive();
      const completed = await queue.getCompleted();
      const failed = await queue.getFailed();

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length
      };

    } catch (error) {
      logger.error('Error getting individual queue stats', { error: error.message });
      throw error;
    }
  }

  /**
   * Limpia trabajos completados y fallidos
   * @param {number} maxCompleted - Máximo de trabajos completados a mantener
   * @param {number} maxFailed - Máximo de trabajos fallidos a mantener
   */
  async cleanQueues(maxCompleted = 50, maxFailed = 25) {
    if (!this.isInitialized) {
      return;
    }

    try {
      await Promise.all([
        this.queues.historical.clean(0, maxCompleted, 'completed'),
        this.queues.historical.clean(0, maxFailed, 'failed'),
        this.queues.latest.clean(0, maxCompleted, 'completed'),
        this.queues.latest.clean(0, maxFailed, 'failed')
      ]);

      logger.info('Queues cleaned', { maxCompleted, maxFailed });

    } catch (error) {
      logger.error('Error cleaning queues', { error: error.message });
      throw error;
    }
  }

  /**
   * Cierra todas las colas y workers
   */
  async shutdown() {
    logger.info('Shutting down QueueManager');

    try {
      // Cerrar workers
      if (this.workers.historical) {
        await this.workers.historical.close();
      }
      if (this.workers.latest) {
        await this.workers.latest.close();
      }

      // Cerrar colas
      if (this.queues.historical) {
        await this.queues.historical.close();
      }
      if (this.queues.latest) {
        await this.queues.latest.close();
      }

      this.isInitialized = false;
      logger.info('QueueManager shutdown complete');

    } catch (error) {
      logger.error('Error shutting down QueueManager', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

export default new QueueManager();