import logger from '../../utils/logger.js';
import config from '../../config/config.js';
import EventBus from '../events/EventBus.js';
import QueueManager from '../queues/QueueManager.js';

/**
 * Gestor de lotes para procesamiento eficiente de datos GPS
 * Maneja dos tipos de lotes: histórico y últimas posiciones
 */
class BatchManager {
  constructor() {
    this.historicalBatch = [];
    this.latestPositions = new Map(); // deviceId -> position
    this.batchInterval = config.batch.interval || 10000; // 10 segundos
    this.maxBatchSize = config.batch.maxSize || 100;
    this.isProcessing = false;
    
    this.initializeBatchProcessing();
    this.setupEventListeners();
  }

  /**
   * Inicializa el procesamiento automático de lotes
   */
  initializeBatchProcessing() {
    this.batchTimer = setInterval(async () => {
      await this.processBatches();
    }, this.batchInterval);

    logger.info('Batch processing initialized', {
      interval: this.batchInterval,
      maxBatchSize: this.maxBatchSize
    });
  }

  /**
   * Configura los listeners de eventos
   */
  setupEventListeners() {
    EventBus.on('position.processed', (position) => {
      this.addToHistoricalBatch(position);
      this.updateLatestPosition(position);
    });

    EventBus.on('app.shutdown', () => {
      this.shutdown();
    });
  }

  /**
   * Agrega una posición al lote histórico
   * @param {Object} position - Posición GPS procesada
   */
  addToHistoricalBatch(position) {
    this.historicalBatch.push({
      ...position,
      batchedAt: new Date()
    });

    logger.debug('Position added to historical batch', {
      deviceId: position.deviceId,
      batchSize: this.historicalBatch.length
    });

    // Procesar inmediatamente si alcanza el tamaño máximo
    if (this.historicalBatch.length >= this.maxBatchSize) {
      setImmediate(() => this.processHistoricalBatch());
    }
  }

  /**
   * Actualiza la última posición de un dispositivo
   * @param {Object} position - Posición GPS procesada
   */
  updateLatestPosition(position) {
    const existingPosition = this.latestPositions.get(position.deviceId);
    
    // Solo actualizar si es más reciente
    if (!existingPosition || position.timestamp > existingPosition.timestamp) {
      this.latestPositions.set(position.deviceId, {
        ...position,
        updatedAt: new Date()
      });

      logger.debug('Latest position updated', {
        deviceId: position.deviceId,
        totalDevices: this.latestPositions.size
      });
    }
  }

  /**
   * Procesa todos los lotes pendientes
   */
  async processBatches() {
    if (this.isProcessing) {
      logger.debug('Batch processing already in progress, skipping');
      return;
    }

    this.isProcessing = true;

    try {
      await Promise.all([
        this.processHistoricalBatch(),
        this.processLatestBatch()
      ]);
    } catch (error) {
      logger.error('Error processing batches', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Procesa el lote histórico
   */
  async processHistoricalBatch() {
    if (this.historicalBatch.length === 0) {
      return;
    }

    const batchToProcess = [...this.historicalBatch];
    this.historicalBatch = []; // Limpiar el lote actual

    try {
      const batchId = `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await QueueManager.addHistoricalBatch({
        batchId,
        positions: batchToProcess,
        count: batchToProcess.length,
        createdAt: new Date().toISOString()
      });

      logger.info('Historical batch queued', {
        batchId,
        count: batchToProcess.length
      });

      EventBus.emit('batch.historical.queued', {
        batchId,
        count: batchToProcess.length
      });

    } catch (error) {
      logger.error('Error processing historical batch', {
        error: error.message,
        batchSize: batchToProcess.length
      });
      
      // Volver a agregar al lote si falló
      this.historicalBatch.unshift(...batchToProcess);
      throw error;
    }
  }

  /**
   * Procesa el lote de últimas posiciones
   */
  async processLatestBatch() {
    if (this.latestPositions.size === 0) {
      return;
    }

    const latestData = Array.from(this.latestPositions.values());
    const deviceIds = Array.from(this.latestPositions.keys());
    this.latestPositions.clear(); // Limpiar el mapa

    try {
      const batchId = `latest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await QueueManager.addLatestBatch({
        batchId,
        positions: latestData,
        deviceIds,
        count: latestData.length,
        createdAt: new Date().toISOString()
      });

      logger.info('Latest positions batch queued', {
        batchId,
        count: latestData.length,
        devices: deviceIds.length
      });

      EventBus.emit('batch.latest.queued', {
        batchId,
        count: latestData.length,
        deviceIds
      });

    } catch (error) {
      logger.error('Error processing latest batch', {
        error: error.message,
        batchSize: latestData.length
      });
      
      // Volver a agregar al mapa si falló
      latestData.forEach(position => {
        this.latestPositions.set(position.deviceId, position);
      });
      throw error;
    }
  }

  /**
   * Fuerza el procesamiento inmediato de todos los lotes
   */
  async forceProcessing() {
    logger.info('Forcing batch processing');
    await this.processBatches();
  }

  /**
   * Obtiene estadísticas de los lotes
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      historical: {
        batchSize: this.historicalBatch.length,
        maxBatchSize: this.maxBatchSize
      },
      latest: {
        deviceCount: this.latestPositions.size,
        devices: Array.from(this.latestPositions.keys())
      },
      processing: {
        interval: this.batchInterval,
        isProcessing: this.isProcessing
      }
    };
  }

  /**
   * Limpia todos los lotes (útil para testing)
   */
  clearBatches() {
    this.historicalBatch = [];
    this.latestPositions.clear();
    logger.info('All batches cleared');
  }

  /**
   * Cierra el gestor de lotes
   */
  async shutdown() {
    logger.info('Shutting down BatchManager');
    
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }

    // Procesar lotes pendientes antes de cerrar
    await this.processBatches();
    
    logger.info('BatchManager shutdown complete');
  }
}

export default new BatchManager();