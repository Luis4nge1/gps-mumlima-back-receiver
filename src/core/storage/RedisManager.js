import redisIOClient from '../../config/redisIO.js';
import logger from '../../utils/logger.js';
import config from '../../config/config.js';
import { compressData, decompressData } from '../../utils/compression.js';
import EventBus from '../events/EventBus.js';

/**
 * Gestor centralizado de Redis para almacenamiento de datos GPS
 * Maneja dos formatos: historial global y últimas posiciones por dispositivo
 */
class RedisManager {
  constructor() {
    this.prefixes = {
      lastPosition: config.redis_prefixes?.lastPosition || 'gps:last:',
      history: config.redis_prefixes?.history || 'gps:history:',
      globalHistory: 'gps:history:global',
      metadata: 'gps:metadata:'
    };
    
    this.maxHistorySize = config.cleanup?.maxHistoryEntries || 100000;

    this.createMetadata = config.metadata || false;
  }

  /**
   * Guarda un lote histórico en Redis
   * @param {Object} batchData - Datos del lote histórico
   */
  async saveHistoricalBatch({ batchId, positions, compressedData, count, createdAt }) {
    try {
      const ttl = config.compression?.ttl || 3600;
      const pipeline = redisIOClient.pipeline();
      
      // Preparar datos para la lista global
      const globalHistoryEntries = positions.map(position => 
        JSON.stringify({
          deviceId: position.deviceId,
          lat: position.lat,
          lng: position.lng,
          timestamp: new Date(position.timestamp).toISOString(),
          receivedAt: new Date(position.receivedAt).toISOString(),
          batchId,
          metadata: position.metadata || {}
        })
      );

      // Agregar todas las entradas a la lista global de una vez
      if (globalHistoryEntries.length > 0) {
        pipeline.rpush(this.prefixes.globalHistory, ...globalHistoryEntries);
        
        // Mantener solo los últimos N registros
        pipeline.ltrim(this.prefixes.globalHistory, -this.maxHistorySize, -1);
      }

      // Guardar metadatos del lote
      const batchMetadata = {
        batchId,
        count,
        createdAt,
        processedAt: new Date().toISOString(),
        compressed: !!compressedData
      };
      
      if(this.createMetadata) {
        pipeline.hset(
          `${this.prefixes.metadata}batch:${batchId}`,
          batchMetadata
        );
      }

      // Opcional: Guardar datos comprimidos para recuperación
      if (compressedData) {
        pipeline.setex(
          `${this.prefixes.history}compressed:${batchId}`,
          tttl, // TTL de 1 hora por defecto
          compressedData.toString('base64')
        );
      }

      await pipeline.exec();

      logger.info('Historical batch saved to Redis', {
        batchId,
        count,
        globalHistorySize: globalHistoryEntries.length
      });

      EventBus.emit('redis.historical.saved', {
        batchId,
        count,
        processedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error saving historical batch to Redis', {
        error: error.message,
        batchId,
        count,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Guarda las últimas posiciones de dispositivos (sin duplicados)
   * @param {Array} positions - Array de posiciones GPS
   */
  async saveLatestPositions(positions) {
    try {
      const pipeline = redisIOClient.pipeline();
      const processedDevices = new Set();

      for (const position of positions) {
        // Evitar duplicados en el mismo lote
        if (processedDevices.has(position.deviceId)) {
          continue;
        }
        processedDevices.add(position.deviceId);

        const key = `${this.prefixes.lastPosition}${position.deviceId}`;
        const positionData = {
          deviceId: position.deviceId,
          lat: position.lat,
          lng: position.lng,
          timestamp: new Date(position.timestamp).toISOString(),
          receivedAt: new Date(position.receivedAt).toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: JSON.stringify(position.metadata || {})
        };

        // Usar HSET para sobrescribir la última posición
        pipeline.hset(key, positionData);
        
        // Opcional: Establecer TTL para limpieza automática
        if (config.cleanup?.enabled) {
          pipeline.expire(key, 86400 * 7); // 7 días
        }
      }

      await pipeline.exec();

      logger.info('Latest positions saved to Redis', {
        deviceCount: processedDevices.size,
        totalPositions: positions.length
      });

      EventBus.emit('redis.latest.saved', {
        deviceCount: processedDevices.size,
        devices: Array.from(processedDevices),
        processedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error saving latest positions to Redis', {
        error: error.message,
        positionCount: positions.length,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Obtiene la última posición de un dispositivo
   * @param {string} deviceId - ID del dispositivo
   * @returns {Object|null} Última posición o null
   */
  async getLastPosition(deviceId) {
    try {
      const key = `${this.prefixes.lastPosition}${deviceId}`;
      const position = await redisIOClient.hgetall(key);

      if (!position || Object.keys(position).length === 0) {
        return null;
      }

      return {
        deviceId: position.deviceId,
        lat: parseFloat(position.lat),
        lng: parseFloat(position.lng),
        timestamp: new Date(position.timestamp),
        receivedAt: new Date(position.receivedAt),
        updatedAt: position.updatedAt,
        metadata: position.metadata ? JSON.parse(position.metadata) : {}
      };

    } catch (error) {
      logger.error('Error retrieving last position', {
        error: error.message,
        deviceId
      });
      throw error;
    }
  }

  /**
   * Obtiene múltiples últimas posiciones
   * @param {Array} deviceIds - Array de IDs de dispositivos
   * @returns {Array} Array de posiciones
   */
  async getLastPositions(deviceIds) {
    try {
      const pipeline = redisIOClient.pipeline();
      
      deviceIds.forEach(deviceId => {
        const key = `${this.prefixes.lastPosition}${deviceId}`;
        pipeline.hgetall(key);
      });

      const results = await pipeline.exec();
      const positions = [];

      results.forEach((result, index) => {
        const [error, position] = result;
        if (!error && position && Object.keys(position).length > 0) {
          positions.push({
            deviceId: position.deviceId,
            lat: parseFloat(position.lat),
            lng: parseFloat(position.lng),
            timestamp: new Date(position.timestamp),
            receivedAt: new Date(position.receivedAt),
            updatedAt: position.updatedAt,
            metadata: position.metadata ? JSON.parse(position.metadata) : {}
          });
        }
      });

      return positions;

    } catch (error) {
      logger.error('Error retrieving multiple last positions', {
        error: error.message,
        deviceCount: deviceIds.length
      });
      throw error;
    }
  }



  /**
   * Obtiene estadísticas del almacenamiento Redis
   * @returns {Object} Estadísticas
   */
  async getStorageStats() {
    try {
      const pipeline = redisIOClient.pipeline();
      
      // Contar registros en historial global
      pipeline.llen(this.prefixes.globalHistory);
      
      // Contar dispositivos con última posición
      pipeline.keys(`${this.prefixes.lastPosition}*`);
      
      // Obtener muestra del historial para análisis
      pipeline.lrange(this.prefixes.globalHistory, -100, -1);

      const [
        [, totalHistoryRecords],
        [, lastPositionKeys],
        [, sampleData]
      ] = await pipeline.exec();

      // Analizar muestra para obtener estadísticas de dispositivos
      const deviceCounts = {};
      const timeRange = { oldest: null, newest: null };

      sampleData.forEach(record => {
        try {
          const parsed = JSON.parse(record);
          deviceCounts[parsed.deviceId] = (deviceCounts[parsed.deviceId] || 0) + 1;
          
          const timestamp = new Date(parsed.timestamp);
          if (!timeRange.oldest || timestamp < timeRange.oldest) {
            timeRange.oldest = timestamp;
          }
          if (!timeRange.newest || timestamp > timeRange.newest) {
            timeRange.newest = timestamp;
          }
        } catch (error) {
          // Ignorar registros malformados
        }
      });

      return {
        globalHistory: {
          totalRecords: totalHistoryRecords,
          maxSize: this.maxHistorySize,
          utilizationPercent: (totalHistoryRecords / this.maxHistorySize * 100).toFixed(2)
        },
        lastPositions: {
          deviceCount: lastPositionKeys.length
        },
        sample: {
          size: sampleData.length,
          uniqueDevices: Object.keys(deviceCounts).length,
          deviceCounts,
          timeRange: {
            oldest: timeRange.oldest?.toISOString(),
            newest: timeRange.newest?.toISOString()
          }
        },
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error getting storage stats', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Limpia datos antiguos según configuración
   */
  async cleanupOldData() {
    try {
      const stats = await this.getStorageStats();
      let cleanedRecords = 0;

      // Limpiar historial global si excede el límite
      if (stats.globalHistory.totalRecords > this.maxHistorySize) {
        const excessRecords = stats.globalHistory.totalRecords - this.maxHistorySize;
        await redisIOClient.ltrim(this.prefixes.globalHistory, excessRecords, -1);
        cleanedRecords += excessRecords;
      }

      // Limpiar posiciones de dispositivos inactivos (opcional)
      if (config.cleanup?.enabled && config.cleanup?.maxDeviceInactivity) {
        const inactiveThreshold = Date.now() - config.cleanup.maxDeviceInactivity;
        const pipeline = redisIOClient.pipeline();
        let inactiveDevices = 0;

        for (const key of await redisIOClient.keys(`${this.prefixes.lastPosition}*`)) {
          const position = await redisIOClient.hget(key, 'updatedAt');
          if (position && new Date(position).getTime() < inactiveThreshold) {
            pipeline.del(key);
            inactiveDevices++;
          }
        }

        if (inactiveDevices > 0) {
          await pipeline.exec();
        }

        logger.info('Cleanup completed', {
          cleanedHistoryRecords: cleanedRecords,
          cleanedInactiveDevices: inactiveDevices
        });
      }

      EventBus.emit('redis.cleanup.completed', {
        cleanedRecords,
        cleanedAt: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Error during cleanup', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

export default new RedisManager();