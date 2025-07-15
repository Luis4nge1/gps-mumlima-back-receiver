import redisClient from '../config/redis.js';
import { addToHistoricalQueue, addToLatestQueue } from '../queues/gpsQueues.js';
import { compressData, decompressData } from '../utils/compression.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
import redisIOClient from '../config/redisIO.js';

class GpsService {
  constructor() {
    this.lastPositionPrefix = config.redis_prefixes.lastPosition;
    this.historicalBatch = [];
    this.latestPositions = new Map(); // Para mantener solo la última posición por dispositivo
    this.batchProcessingInterval = config.batch.interval || 10000; // 10 segundos por defecto
    this.maxBatchSize = config.batch.maxSize || 100; // Máximo 100 elementos por batch
    
    // Iniciar el procesamiento por lotes
    this.startBatchProcessing();
  }
  
  /**
   * Inicia el procesamiento por lotes cada N segundos
   */
  startBatchProcessing() {
    setInterval(async () => {
      await this.processBatches();
    }, this.batchProcessingInterval);
    
    logger.info('Batch processing started', {
      interval: this.batchProcessingInterval,
      maxBatchSize: this.maxBatchSize
    });
  }

  /**
   * Procesa los lotes acumulados
   */
  async processBatches() {
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
    }
  }

  /**
   * Procesa el lote histórico
   */
  async processHistoricalBatch() {
    if (this.historicalBatch.length === 0) return;

    const batchToProcess = [...this.historicalBatch];
    this.historicalBatch = []; // Limpiar el lote actual

    try {
      // Comprimir y encolar todo el lote
      const compressedBatch = await compressData(batchToProcess);
      
      await addToHistoricalQueue({
        batchId: `batch_${Date.now()}`,
        data: compressedBatch.toString('base64'),
        count: batchToProcess.length,
        timestamp: new Date().toISOString()
      });

      logger.info('Historical batch processed', {
        batchSize: batchToProcess.length,
        compressed: true
      });

    } catch (error) {
      logger.error('Error processing historical batch', {
        error: error.message,
        batchSize: batchToProcess.length
      });
      // Volver a agregar al lote si falló
      this.historicalBatch.unshift(...batchToProcess);
    }
  }

  /**
   * Procesa el lote de últimas posiciones
   */
  async processLatestBatch() {
    if (this.latestPositions.size === 0) return;

    const latestData = Array.from(this.latestPositions.values());
    this.latestPositions.clear(); // Limpiar el mapa

    try {
      // Comprimir y encolar solo las últimas posiciones
      const compressedLatest = await compressData(latestData);
      
      await addToLatestQueue({
        batchId: `latest_${Date.now()}`,
        data: compressedLatest.toString('base64'),
        count: latestData.length,
        timestamp: new Date().toISOString()
      });

      logger.info('Latest positions batch processed', {
        batchSize: latestData.length,
        compressed: true
      });

    } catch (error) {
      logger.error('Error processing latest batch', {
        error: error.message,
        batchSize: latestData.length
      });
      // Volver a agregar al mapa si falló
      latestData.forEach(position => {
        this.latestPositions.set(position.id, position);
      });
    }
  }

  /**
   * Procesa una posición GPS individual (solo encola, no guarda directamente)
   * @param {Object} position - Datos de posición GPS
   * @returns {Object} Resultado del procesamiento
   */
  async processGpsPosition(position) {
    try {
      const { id, lat, lng, timestamp } = position;

      const processedPosition = {
        id: String(id),
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        timestamp: new Date(timestamp),
        receivedAt: new Date()
      };

      // Verificar si es duplicado antes de agregar
      const isDuplicate = await this.isDuplicateInBatch(processedPosition);
      
      if (isDuplicate) {
        logger.debug('Duplicate position detected, skipping', {
          deviceId: id,
          lat,
          lng,
          timestamp
        });
        return {
          processed: false,
          queued: false,
          duplicate: true
        };
      }

      // Agregar a lote histórico
      this.historicalBatch.push(processedPosition);
      
      // Actualizar última posición (sobrescribe si existe)
      this.latestPositions.set(processedPosition.id, processedPosition);

      // Procesar inmediatamente si alcanza el tamaño máximo
      if (this.historicalBatch.length >= this.maxBatchSize) {
        await this.processHistoricalBatch();
      }
      
      logger.debug('GPS position added to batch', {
        deviceId: id,
        historicalBatchSize: this.historicalBatch.length,
        latestPositionsCount: this.latestPositions.size
      });
      
      return {
        processed: true,
        queued: true,
        duplicate: false,
        batchSize: this.historicalBatch.length
      };
      
    } catch (error) {
      logger.error('Error processing GPS position', {
        error: error.message,
        deviceId: position?.id,
        stack: error.stack
      });
      throw new AppError('Failed to process GPS position', 500);
    }
  }

  /**
   * Procesa un lote de posiciones GPS
   * @param {Array} positions - Array de posiciones GPS
   * @returns {Object} Resultados del procesamiento
   */
  async processBatchGpsPositions(positions) {
    const results = {
      processed: 0,
      duplicates: 0,
      errors: 0
    };
    
    for (const position of positions) {
      try {
        const result = await this.processGpsPosition(position);
        
        if (result.duplicate) {
          results.duplicates++;
        } else if (result.processed) {
          results.processed++;
        }
        
      } catch (error) {
        results.errors++;
        logger.error('Error processing position in batch', {
          error: error.message,
          position: position
        });
      }
    }
    
    return results;
  }

  /**
   * Verifica si una posición es duplicada en el lote actual
   * @param {Object} position - Posición GPS
   * @returns {boolean} True si es duplicada
   */
  async isDuplicateInBatch(position) {
    try {
      // Verificar en el lote actual
      const existingInBatch = this.historicalBatch.find(p => 
        p.id === position.id &&
        p.lat === position.lat &&
        p.lng === position.lng &&
        Math.abs(p.timestamp - position.timestamp) < 1000 // 1 segundo de diferencia
      );

      if (existingInBatch) return true;

      // Verificar en las últimas posiciones
      const existingLatest = this.latestPositions.get(position.id);
      if (existingLatest) {
        return (
          existingLatest.lat === position.lat &&
          existingLatest.lng === position.lng &&
          Math.abs(existingLatest.timestamp - position.timestamp) < 1000
        );
      }

      return false;
      
    } catch (error) {
      logger.error('Error checking duplicate in batch', {
        error: error.message,
        deviceId: position.id
      });
      return false;
    }
  }

  /**
   * Verifica si una posición es duplicada (versión original mantenida para compatibilidad)
   * @param {string} deviceId - ID del dispositivo
   * @param {number} lat - Latitud
   * @param {number} lng - Longitud
   * @param {Date} timestamp - Timestamp
   * @returns {boolean} True si es duplicada
   */
  async isDuplicatePosition(deviceId, lat, lng, timestamp) {
    try {
      const lastPosition = await this.getLastPosition(deviceId);
      
      if (!lastPosition) {
        return false;
      }
      
      return (
        lastPosition.lat === lat &&
        lastPosition.lng === lng &&
        lastPosition.timestamp === timestamp.toISOString()
      );
      
    } catch (error) {
      logger.error('Error checking duplicate position', {
        error: error.message,
        deviceId
      });
      return false;
    }
  }

  /**
   * Obtiene la última posición conocida de un dispositivo
   * @param {string} deviceId - ID del dispositivo
   * @returns {Object|null} Última posición o null si no se encuentra
   */
  async getLastPosition(deviceId) {
    try {
      const key = `${this.lastPositionPrefix}${deviceId}`;
      const position = await redisIOClient.hgetall(key);
      
      if (!position || Object.keys(position).length === 0) {
        return null;
      }
      
      return {
        id: position.id,
        lat: parseFloat(position.lat),
        lng: parseFloat(position.lng),
        timestamp: position.timestamp,
        updatedAt: position.updatedAt
      };
      
    } catch (error) {
      logger.error('Error retrieving last position', {
        error: error.message,
        deviceId
      });
      throw new AppError('Failed to retrieve last position', 500);
    }
  }

  /**
   * Obtiene estadísticas de los lotes actuales
   * @returns {Object} Estadísticas de lotes
   */
  getBatchStats() {
    return {
      historicalBatchSize: this.historicalBatch.length,
      latestPositionsCount: this.latestPositions.size,
      maxBatchSize: this.maxBatchSize,
      batchInterval: this.batchProcessingInterval
    };
  }

  /**
   * Fuerza el procesamiento de lotes (útil para testing o shutdown)
   */
  async forceBatchProcessing() {
    await this.processBatches();
  }

  /**
   * Limpia todos los lotes (útil para testing)
   */
  clearBatches() {
    this.historicalBatch = [];
    this.latestPositions.clear();
  }
}

export default new GpsService();