import { EventEmitter } from 'events';
import logger from '../../utils/logger.js';

/**
 * Bus de eventos centralizado para comunicación entre módulos
 * Permite desacoplar componentes y facilitar el monitoreo
 */
class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Aumentar límite para múltiples listeners
    this.setupDefaultHandlers();
  }

  /**
   * Configura manejadores por defecto para logging
   */
  setupDefaultHandlers() {
    // Eventos de posiciones GPS
    this.on('position.processed', (position) => {
      logger.debug('Position processed event', {
        deviceId: position.deviceId,
        timestamp: position.timestamp
      });
    });

    this.on('batch.processed', (stats) => {
      logger.info('Batch processed event', stats);
    });

    // Eventos de colas
    this.on('batch.historical.queued', (data) => {
      logger.debug('Historical batch queued', data);
    });

    this.on('batch.latest.queued', (data) => {
      logger.debug('Latest batch queued', data);
    });

    this.on('batch.historical.processed', (result) => {
      logger.info('Historical batch processed', result);
    });

    this.on('batch.latest.processed', (result) => {
      logger.info('Latest batch processed', result);
    });

    // Eventos de Redis
    this.on('redis.historical.saved', (data) => {
      logger.debug('Historical data saved to Redis', data);
    });

    this.on('redis.latest.saved', (data) => {
      logger.debug('Latest positions saved to Redis', data);
    });

    this.on('redis.history.cleaned', (data) => {
      logger.info('Redis history cleaned', data);
    });

    this.on('redis.cleanup.completed', (data) => {
      logger.info('Redis cleanup completed', data);
    });

    // Eventos de sistema
    this.on('app.shutdown', () => {
      logger.info('Application shutdown event received');
    });

    // Eventos de error
    this.on('error', (error) => {
      logger.error('EventBus error', {
        error: error.message,
        stack: error.stack
      });
    });

    // Eventos de métricas
    this.on('metrics.updated', (metrics) => {
      logger.debug('Metrics updated', metrics);
    });
  }

  /**
   * Emite un evento con manejo de errores
   * @param {string} eventName - Nombre del evento
   * @param {*} data - Datos del evento
   */
  safeEmit(eventName, data) {
    try {
      this.emit(eventName, data);
    } catch (error) {
      logger.error('Error emitting event', {
        eventName,
        error: error.message,
        data: typeof data === 'object' ? JSON.stringify(data) : data
      });
    }
  }

  /**
   * Registra un listener con manejo de errores
   * @param {string} eventName - Nombre del evento
   * @param {Function} listener - Función listener
   */
  safeOn(eventName, listener) {
    const wrappedListener = (...args) => {
      try {
        listener(...args);
      } catch (error) {
        logger.error('Error in event listener', {
          eventName,
          error: error.message,
          stack: error.stack
        });
      }
    };

    this.on(eventName, wrappedListener);
    return wrappedListener;
  }

  /**
   * Obtiene estadísticas del bus de eventos
   * @returns {Object} Estadísticas
   */
  getStats() {
    const eventNames = this.eventNames();
    const stats = {
      totalEvents: eventNames.length,
      events: {}
    };

    eventNames.forEach(eventName => {
      stats.events[eventName] = this.listenerCount(eventName);
    });

    return stats;
  }

  /**
   * Limpia todos los listeners (útil para testing)
   */
  clearAllListeners() {
    this.removeAllListeners();
    this.setupDefaultHandlers();
    logger.info('All event listeners cleared and default handlers restored');
  }
}

// Exportar instancia singleton
export default new EventBus();