import logger from '../../utils/logger.js';
import { AppError } from '../../errors/AppError.js';
import EventBus from '../events/EventBus.js';
import config from '../../config/config.js';

/**
 * Procesador central de datos GPS
 * Maneja la validación, normalización y enrutamiento de datos GPS
 */
class GpsDataProcessor {
  constructor() {
    this.duplicateCache = new Map();
    this.duplicateEnabled = config.duplicate?.enabled ?? true;
    this.duplicateThreshold = config.duplicate?.timeThreshold || 1000; // 1 segundo
    this.coordinateThreshold = config.duplicate?.coordinateThreshold || 0.0001; // ~10 metros
    this.maxCacheSize = config.duplicate?.maxCacheSize || 1000; // Máximo dispositivos en cache
  }

  /**
   * Procesa una posición GPS individual
   * @param {Object} rawPosition - Datos GPS sin procesar
   * @returns {Object} Posición procesada
   */
  async processPosition(rawPosition) {
    try {
      // Normalizar datos
      const position = this.normalizePosition(rawPosition);
      
      // Validar datos
      this.validatePosition(position);
      
      // Verificar duplicados
      if (this.isDuplicate(position)) {
        logger.debug('Duplicate position detected', { deviceId: position.deviceId });
        return { processed: false, duplicate: true, position: null };
      }
      
      // Actualizar cache de duplicados
      this.updateDuplicateCache(position);
      
      // Emitir evento de posición procesada
      EventBus.emit('position.processed', position);
      
      logger.debug('Position processed successfully', { 
        deviceId: position.deviceId,
        lat: position.lat,
        lng: position.lng 
      });
      
      return { processed: true, duplicate: false, position };
      
    } catch (error) {
      logger.error('Error processing GPS position', {
        error: error.message,
        rawPosition,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Procesa un lote de posiciones GPS
   * @param {Array} rawPositions - Array de posiciones GPS sin procesar
   * @returns {Object} Resultados del procesamiento
   */
  async processBatch(rawPositions) {
    const results = {
      processed: [],
      duplicates: [],
      errors: []
    };

    for (const rawPosition of rawPositions) {
      try {
        const result = await this.processPosition(rawPosition);
        
        if (result.duplicate) {
          results.duplicates.push(rawPosition);
        } else if (result.processed) {
          results.processed.push(result.position);
        }
        
      } catch (error) {
        results.errors.push({
          position: rawPosition,
          error: error.message
        });
      }
    }

    // Emitir evento de lote procesado
    EventBus.emit('batch.processed', {
      totalCount: rawPositions.length,
      processedCount: results.processed.length,
      duplicateCount: results.duplicates.length,
      errorCount: results.errors.length
    });

    return results;
  }

  /**
   * Normaliza una posición GPS
   * @param {Object} rawPosition - Posición sin procesar
   * @returns {Object} Posición normalizada
   */
  normalizePosition(rawPosition) {
    const now = new Date();
    
    return {
      deviceId: String(rawPosition.id || rawPosition.deviceId),
      lat: parseFloat(rawPosition.lat || rawPosition.latitude),
      lng: parseFloat(rawPosition.lng || rawPosition.longitude),
      timestamp: rawPosition.timestamp ? new Date(rawPosition.timestamp) : now,
      receivedAt: now,
      metadata: {
        speed: rawPosition.speed ? parseFloat(rawPosition.speed) : null,
        heading: rawPosition.heading ? parseFloat(rawPosition.heading) : null,
        altitude: rawPosition.altitude ? parseFloat(rawPosition.altitude) : null,
        accuracy: rawPosition.accuracy ? parseFloat(rawPosition.accuracy) : null,
        ...rawPosition.metadata
      }
    };
  }

  /**
   * Valida una posición GPS
   * @param {Object} position - Posición a validar
   * @throws {AppError} Si la validación falla
   */
  validatePosition(position) {
    if (!position.deviceId) {
      throw new AppError('Device ID is required', 400);
    }

    if (typeof position.lat !== 'number' || isNaN(position.lat)) {
      throw new AppError('Valid latitude is required', 400);
    }

    if (typeof position.lng !== 'number' || isNaN(position.lng)) {
      throw new AppError('Valid longitude is required', 400);
    }

    if (position.lat < -90 || position.lat > 90) {
      throw new AppError('Latitude must be between -90 and 90', 400);
    }

    if (position.lng < -180 || position.lng > 180) {
      throw new AppError('Longitude must be between -180 and 180', 400);
    }

    if (!(position.timestamp instanceof Date) || isNaN(position.timestamp.getTime())) {
      throw new AppError('Valid timestamp is required', 400);
    }

    // Validar que el timestamp no sea muy antiguo o muy futuro
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 horas
    const maxFuture = 5 * 60 * 1000; // 5 minutos

    if (now - position.timestamp.getTime() > maxAge) {
      throw new AppError('Timestamp is too old', 400);
    }

    if (position.timestamp.getTime() - now > maxFuture) {
      throw new AppError('Timestamp is too far in the future', 400);
    }
  }

  /**
   * Verifica si una posición es duplicada
   * @param {Object} position - Posición a verificar
   * @returns {boolean} True si es duplicada
   */
  isDuplicate(position) {
    // Si la detección de duplicados está deshabilitada, nunca es duplicado
    if (!this.duplicateEnabled) {
      return false;
    }

    const cacheKey = position.deviceId;
    const lastPosition = this.duplicateCache.get(cacheKey);

    if (!lastPosition) {
      return false;
    }

    // Verificar diferencia de tiempo
    const timeDiff = Math.abs(position.timestamp.getTime() - lastPosition.timestamp.getTime());
    if (timeDiff > this.duplicateThreshold) {
      return false;
    }

    // Verificar diferencia de coordenadas
    const latDiff = Math.abs(position.lat - lastPosition.lat);
    const lngDiff = Math.abs(position.lng - lastPosition.lng);

    return latDiff < this.coordinateThreshold && lngDiff < this.coordinateThreshold;
  }

  /**
   * Actualiza el cache de duplicados
   * @param {Object} position - Posición a cachear
   */
  updateDuplicateCache(position) {
    // Solo actualizar cache si la detección de duplicados está habilitada
    if (!this.duplicateEnabled) {
      return;
    }

    this.duplicateCache.set(position.deviceId, {
      lat: position.lat,
      lng: position.lng,
      timestamp: position.timestamp
    });

    // Limpiar cache antiguo (mantener solo los últimos N dispositivos)
    if (this.duplicateCache.size > this.maxCacheSize) {
      const firstKey = this.duplicateCache.keys().next().value;
      this.duplicateCache.delete(firstKey);
    }
  }

  /**
   * Limpia el cache de duplicados
   */
  clearDuplicateCache() {
    this.duplicateCache.clear();
  }

  /**
   * Obtiene estadísticas del procesador
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      duplicateDetection: {
        enabled: this.duplicateEnabled,
        cacheSize: this.duplicateCache.size,
        maxCacheSize: this.maxCacheSize,
        timeThreshold: this.duplicateThreshold,
        coordinateThreshold: this.coordinateThreshold
      }
    };
  }
}

export default new GpsDataProcessor();