import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
import { 
  GpsDataProcessor, 
  BatchManager, 
  QueueManager, 
  RedisManager, 
  EventBus 
} from '../core/index.js';

/**
 * Servicio principal de procesamiento GPS
 * Orquesta todos los módulos del core para el procesamiento completo
 */
class GpsProcessingService {
  constructor() {
    this.isInitialized = false;
    this.stats = {
      totalProcessed: 0,
      totalDuplicates: 0,
      totalErrors: 0,
      startTime: new Date()
    };
    
    this.setupEventListeners();
  }

  /**
   * Inicializa el servicio
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Inicializar QueueManager
      await QueueManager.initialize();
      
      this.isInitialized = true;
      logger.info('GpsProcessingService initialized successfully');
      
    } catch (error) {
      logger.error('Error initializing GpsProcessingService', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Configura los listeners de eventos para estadísticas
   */
  setupEventListeners() {
    EventBus.on('position.processed', () => {
      this.stats.totalProcessed++;
    });

    EventBus.on('batch.processed', (batchStats) => {
      this.stats.totalDuplicates += batchStats.duplicateCount;
      this.stats.totalErrors += batchStats.errorCount;
    });
  }

  /**
   * Procesa una posición GPS individual
   * @param {Object} rawPosition - Datos GPS sin procesar
   * @returns {Object} Resultado del procesamiento
   */
  async processPosition(rawPosition) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const result = await GpsDataProcessor.processPosition(rawPosition);
      
      logger.debug('GPS position processed', {
        deviceId: rawPosition.id || rawPosition.deviceId,
        processed: result.processed,
        duplicate: result.duplicate
      });

      return {
        //success: true,
        processed: result.processed,
        duplicate: result.duplicate,
        deviceId: rawPosition.id || rawPosition.deviceId,
        //message: result.duplicate ? 'Position was duplicate' : 'Position queued for processing'
      };

    } catch (error) {
      this.stats.totalErrors++;
      logger.error('Error processing GPS position', {
        error: error.message,
        rawPosition,
        stack: error.stack
      });

      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError('Failed to process GPS position', 500);
    }
  }

  /**
   * Procesa un lote de posiciones GPS
   * @param {Array} rawPositions - Array de posiciones GPS sin procesar
   * @returns {Object} Resultados del procesamiento
   */
  async processBatch(rawPositions) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const results = await GpsDataProcessor.processBatch(rawPositions);

      logger.info('GPS batch processed', {
        totalPositions: rawPositions.length,
        processed: results.processed.length,
        duplicates: results.duplicates.length,
        errors: results.errors.length
      });

      return {
        success: true,
        totalPositions: rawPositions.length,
        processed: results.processed.length,
        duplicates: results.duplicates.length,
        errors: results.errors.length,
        message: `Processed ${results.processed.length} positions, ${results.duplicates.length} duplicates, ${results.errors.length} errors`
      };

    } catch (error) {
      logger.error('Error processing GPS batch', {
        error: error.message,
        positionsCount: rawPositions.length,
        stack: error.stack
      });

      throw new AppError('Failed to process GPS batch', 500);
    }
  }

  /**
   * Obtiene la última posición de un dispositivo
   * @param {string} deviceId - ID del dispositivo
   * @returns {Object|null} Última posición o null
   */
  async getLastPosition(deviceId) {
    try {
      return await RedisManager.getLastPosition(deviceId);
    } catch (error) {
      logger.error('Error retrieving last position', {
        error: error.message,
        deviceId
      });
      throw new AppError('Failed to retrieve last position', 500);
    }
  }

  /**
   * Obtiene múltiples últimas posiciones
   * @param {Array} deviceIds - Array de IDs de dispositivos
   * @returns {Array} Array de posiciones
   */
  async getLastPositions(deviceIds) {
    try {
      return await RedisManager.getLastPositions(deviceIds);
    } catch (error) {
      logger.error('Error retrieving multiple last positions', {
        error: error.message,
        deviceCount: deviceIds.length
      });
      throw new AppError('Failed to retrieve last positions', 500);
    }
  }



  /**
   * Fuerza el procesamiento inmediato de lotes
   */
  async forceBatchProcessing() {
    try {
      await BatchManager.forceProcessing();
      logger.info('Batch processing forced');
    } catch (error) {
      logger.error('Error forcing batch processing', {
        error: error.message
      });
      throw new AppError('Failed to force batch processing', 500);
    }
  }

  /**
   * Obtiene estadísticas completas del sistema
   * @returns {Object} Estadísticas del sistema
   */
  async getSystemStats() {
    try {
      const [
        queueStats,
        batchStats,
        storageStats,
        processorStats,
        eventStats
      ] = await Promise.all([
        QueueManager.getStats(),
        Promise.resolve(BatchManager.getStats()),
        RedisManager.getStorageStats(),
        Promise.resolve(GpsDataProcessor.getStats()),
        Promise.resolve(EventBus.getStats())
      ]);

      return {
        service: {
          ...this.stats,
          uptime: Date.now() - this.stats.startTime.getTime(),
          initialized: this.isInitialized
        },
        queues: queueStats,
        batches: batchStats,
        storage: storageStats,
        processor: processorStats,
        events: eventStats,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error getting system stats', {
        error: error.message
      });
      throw new AppError('Failed to get system stats', 500);
    }
  }

  /**
   * Realiza limpieza del sistema
   */
  async performCleanup() {
    try {
      await Promise.all([
        QueueManager.cleanQueues(),
        RedisManager.cleanupOldData()
      ]);

      logger.info('System cleanup completed');
    } catch (error) {
      logger.error('Error during system cleanup', {
        error: error.message
      });
      throw new AppError('Failed to perform system cleanup', 500);
    }
  }

  /**
   * Limpia todos los lotes (útil para testing)
   */
  clearBatches() {
    BatchManager.clearBatches();
    GpsDataProcessor.clearDuplicateCache();
    logger.info('All batches and caches cleared');
  }

  /**
   * Cierra el servicio de manera ordenada
   */
  async shutdown() {
    logger.info('Shutting down GpsProcessingService');

    try {
      // Emitir evento de shutdown
      EventBus.emit('app.shutdown');

      // Cerrar componentes en orden
      await BatchManager.shutdown();
      await QueueManager.shutdown();

      this.isInitialized = false;
      logger.info('GpsProcessingService shutdown complete');

    } catch (error) {
      logger.error('Error during GpsProcessingService shutdown', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Verifica el estado de salud del servicio
   * @returns {Object} Estado de salud
   */
  async healthCheck() {
    try {
      const stats = await this.getSystemStats();
      
      const health = {
        status: 'healthy',
        initialized: this.isInitialized,
        uptime: stats.service.uptime,
        components: {
          processor: 'healthy',
          batchManager: 'healthy',
          queueManager: stats.queues.initialized ? 'healthy' : 'unhealthy',
          redisManager: 'healthy',
          eventBus: 'healthy'
        },
        metrics: {
          totalProcessed: this.stats.totalProcessed,
          totalDuplicates: this.stats.totalDuplicates,
          totalErrors: this.stats.totalErrors,
          batchSizes: {
            historical: stats.batches.historical.batchSize,
            latest: stats.batches.latest.deviceCount
          },
          queueSizes: {
            historicalWaiting: stats.queues.historical?.waiting || 0,
            latestWaiting: stats.queues.latest?.waiting || 0
          }
        },
        timestamp: new Date().toISOString()
      };

      // Determinar estado general
      const unhealthyComponents = Object.values(health.components)
        .filter(status => status === 'unhealthy').length;
      
      if (unhealthyComponents > 0) {
        health.status = 'degraded';
      }

      return health;

    } catch (error) {
      logger.error('Health check failed', {
        error: error.message
      });

      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default new GpsProcessingService();