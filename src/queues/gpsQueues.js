import { Queue, Worker } from 'bullmq';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { decompressData } from '../utils/compression.js';
import redisIOClient from '../config/redisIO.js';

// Crear cola para datos históricos
export const historicalQueue = new Queue('gps-historical-batch', {
  connection: redisIOClient,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

// Crear cola para últimas posiciones
export const latestQueue = new Queue('gps-latest-batch', {
  connection: redisIOClient,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 25,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
});

// Worker para procesar lotes históricos
export const historicalWorker = new Worker(
  'gps-historical-batch',
  async (job) => {
    try {
      const { batchId, data, count, timestamp } = job.data;
      
      // Descomprimir el lote de datos GPS
      const buffer = Buffer.from(data, 'base64');
      const decompressedBatch = await decompressData(buffer);

      logger.info('Processing historical GPS batch', {
        jobId: job.id,
        batchId,
        count,
        timestamp
      });

      // Procesar cada posición en el lote
      const results = [];
      const globalHistoryData = []; // Array para almacenar todas las posiciones del lote
      
      for (const position of decompressedBatch) {
        try {
          const deviceId = position.id;
          
          // Preparar datos para la lista global
          const historyEntry = {
            deviceId: deviceId,
            lat: position.lat,
            lng: position.lng,
            timestamp: position.timestamp.toISOString ? position.timestamp.toISOString() : position.timestamp,
            receivedAt: position.receivedAt.toISOString ? position.receivedAt.toISOString() : position.receivedAt
          };

          globalHistoryData.push(JSON.stringify(historyEntry));
          
          results.push({
            deviceId,
            processed: true,
            timestamp: position.timestamp
          });

          logger.debug('Historical position prepared', {
            deviceId,
            lat: position.lat,
            lng: position.lng
          });

        } catch (error) {
          logger.error('Error processing single position in historical batch', {
            error: error.message,
            position: position
          });
          results.push({
            deviceId: position.id,
            processed: false,
            error: error.message
          });
        }
      }

      // Guardar todo el lote en la lista global de una sola vez
      if (globalHistoryData.length > 0) {
        await redisIOClient.rpush('gps:history:global', ...globalHistoryData);
        
        // Opcional: Limitar el tamaño de la lista global (mantener solo los últimos N registros)
        const maxHistorySize = config.gps?.maxHistorySize || 100000; // 100k registros por defecto
        await redisIOClient.ltrim('gps:history:global', -maxHistorySize, -1);
        
        logger.info('Historical GPS batch saved to global list', {
          batchId,
          savedCount: globalHistoryData.length,
          maxHistorySize
        });
      }

      logger.info('Historical GPS batch processed', {
        jobId: job.id,
        batchId,
        totalPositions: count,
        successfullyProcessed: results.filter(r => r.processed).length,
        errors: results.filter(r => !r.processed).length
      });
      
      return { 
        success: true, 
        batchId, 
        processedCount: results.filter(r => r.processed).length,
        errorCount: results.filter(r => !r.processed).length,
        processedAt: new Date().toISOString() 
      };
      
    } catch (error) {
      logger.error('Error processing historical GPS batch', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  },
  {
    connection: redisIOClient,
    concurrency: config.queue.concurrency || 5,
  }
);

// Worker para procesar últimas posiciones
export const latestWorker = new Worker(
  'gps-latest-batch',
  async (job) => {
    try {
      const { batchId, data, count, timestamp } = job.data;
      
      // Descomprimir el lote de últimas posiciones
      const buffer = Buffer.from(data, 'base64');
      const decompressedBatch = await decompressData(buffer);

      logger.info('Processing latest GPS positions batch', {
        jobId: job.id,
        batchId,
        count,
        timestamp
      });

      // Procesar cada última posición en el lote
      const results = [];
      for (const position of decompressedBatch) {
        try {
          const deviceId = position.id;
          
          // Guardar en Redis como última posición (sobrescribe)
          const lastPositionKey = `gps:last:${deviceId}`;
          const lastPositionData = {
            id: position.id,
            lat: position.lat,
            lng: position.lng,
            timestamp: position.timestamp.toISOString ? position.timestamp.toISOString() : position.timestamp,
            receivedAt: position.receivedAt.toISOString ? position.receivedAt.toISOString() : position.receivedAt,
            updatedAt: new Date().toISOString()
          };

          await redisIOClient.hset(lastPositionKey, lastPositionData);
          
          results.push({
            deviceId,
            processed: true,
            timestamp: position.timestamp
          });

          logger.debug('Latest position processed', {
            deviceId,
            lat: position.lat,
            lng: position.lng
          });

        } catch (error) {
          logger.error('Error processing single position in latest batch', {
            error: error.message,
            position: position
          });
          results.push({
            deviceId: position.id,
            processed: false,
            error: error.message
          });
        }
      }

      logger.info('Latest GPS positions batch processed', {
        jobId: job.id,
        batchId,
        totalPositions: count,
        successfullyProcessed: results.filter(r => r.processed).length,
        errors: results.filter(r => !r.processed).length
      });
      
      return { 
        success: true, 
        batchId, 
        processedCount: results.filter(r => r.processed).length,
        errorCount: results.filter(r => !r.processed).length,
        processedAt: new Date().toISOString() 
      };
      
    } catch (error) {
      logger.error('Error processing latest GPS positions batch', {
        jobId: job.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  },
  {
    connection: redisIOClient,
    concurrency: config.queue.concurrency || 3,
  }
);

// Event handlers para cola histórica
historicalQueue.on('completed', (job, result) => {
  logger.info('Historical batch job completed', {
    jobId: job.id,
    batchId: result.batchId,
    processedCount: result.processedCount
  });
});

historicalQueue.on('failed', (job, err) => {
  logger.error('Historical batch job failed', {
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade
  });
});

// Event handlers para cola de últimas posiciones
latestQueue.on('completed', (job, result) => {
  logger.info('Latest positions batch job completed', {
    jobId: job.id,
    batchId: result.batchId,
    processedCount: result.processedCount
  });
});

latestQueue.on('failed', (job, err) => {
  logger.error('Latest positions batch job failed', {
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade
  });
});

// Event handlers para workers
historicalWorker.on('completed', (job, result) => {
  logger.debug('Historical worker completed job', {
    jobId: job.id,
    batchId: result.batchId
  });
});

historicalWorker.on('failed', (job, err) => {
  logger.error('Historical worker failed', {
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade
  });
});

latestWorker.on('completed', (job, result) => {
  logger.debug('Latest worker completed job', {
    jobId: job.id,
    batchId: result.batchId
  });
});

latestWorker.on('failed', (job, err) => {
  logger.error('Latest worker failed', {
    jobId: job.id,
    error: err.message,
    attempts: job.attemptsMade
  });
});

/**
 * Agregar lote de datos GPS históricos a la cola
 * @param {Object} data - Datos del lote
 * @returns {Promise<Object>} Información del job
 */
export const addToHistoricalQueue = async (data) => {
  try {
    const job = await historicalQueue.add('process-gps-historical-batch', data, {
      priority: 2, // Prioridad media para datos históricos
      delay: 0,
    });
    
    logger.debug('GPS historical batch added to queue', {
      jobId: job.id,
      batchId: data.batchId,
      count: data.count
    });
    
    return job;
  } catch (error) {
    logger.error('Error adding historical batch to queue', {
      error: error.message,
      data: data
    });
    throw error;
  }
};

/**
 * Agregar lote de últimas posiciones GPS a la cola
 * @param {Object} data - Datos del lote
 * @returns {Promise<Object>} Información del job
 */
export const addToLatestQueue = async (data) => {
  try {
    const job = await latestQueue.add('process-gps-latest-batch', data, {
      priority: 1, // Alta prioridad para últimas posiciones
      delay: 0,
    });
    
    logger.debug('GPS latest positions batch added to queue', {
      jobId: job.id,
      batchId: data.batchId,
      count: data.count
    });
    
    return job;
  } catch (error) {
    logger.error('Error adding latest batch to queue', {
      error: error.message,
      data: data
    });
    throw error;
  }
};

/**
 * Obtener estadísticas de las colas
 * @returns {Promise<Object>} Estadísticas de las colas
 */
export const getQueuesStats = async () => {
  try {
    const [historicalStats, latestStats] = await Promise.all([
      getQueueStats(historicalQueue),
      getQueueStats(latestQueue)
    ]);
    
    return {
      historical: historicalStats,
      latest: latestStats
    };
  } catch (error) {
    logger.error('Error getting queues stats', { error: error.message });
    throw error;
  }
};

/**
 * Obtener estadísticas de una cola específica
 * @param {Queue} queue - Cola a consultar
 * @returns {Promise<Object>} Estadísticas de la cola
 */
const getQueueStats = async (queue) => {
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
    logger.error('Error getting queue stats', { error: error.message });
    throw error;
  }
};

/**
 * Limpiar trabajos completados y fallidos
 * @param {number} maxCompleted - Máximo de trabajos completados a mantener
 * @param {number} maxFailed - Máximo de trabajos fallidos a mantener
 */
export const cleanQueues = async (maxCompleted = 50, maxFailed = 25) => {
  try {
    await Promise.all([
      historicalQueue.clean(0, maxCompleted, 'completed'),
      historicalQueue.clean(0, maxFailed, 'failed'),
      latestQueue.clean(0, maxCompleted, 'completed'),
      latestQueue.clean(0, maxFailed, 'failed')
    ]);
    
    logger.info('Queues cleaned', {
      maxCompleted,
      maxFailed
    });
  } catch (error) {
    logger.error('Error cleaning queues', { error: error.message });
    throw error;
  }
};

/**
 * Obtener estadísticas del historial global
 * @returns {Promise<Object>} Estadísticas del historial
 */
export const getGlobalHistoryStats = async () => {
  try {
    const totalRecords = await redisIOClient.llen('gps:history:global');
    
    // Obtener muestra de los últimos registros para análisis
    const sampleSize = Math.min(100, totalRecords);
    const sampleData = await redisIOClient.lrange('gps:history:global', -sampleSize, -1);
    
    const deviceCounts = {};
    sampleData.forEach(record => {
      try {
        const parsed = JSON.parse(record);
        deviceCounts[parsed.deviceId] = (deviceCounts[parsed.deviceId] || 0) + 1;
      } catch (error) {
        // Ignorar registros malformados
      }
    });
    
    return {
      totalRecords,
      sampleSize,
      uniqueDevicesInSample: Object.keys(deviceCounts).length,
      deviceCounts
    };
  } catch (error) {
    logger.error('Error getting global history stats', { error: error.message });
    throw error;
  }
};

/**
 * Obtener registros del historial global para transferir a BigQuery
 * @param {number} batchSize - Tamaño del lote a obtener
 * @returns {Promise<Array>} Array de registros GPS
 */
export const getHistoryBatchForBigQuery = async (batchSize = 1000) => {
  try {
    const rawData = await redisIOClient.lrange('gps:history:global', 0, batchSize - 1);
    
    if (rawData.length === 0) {
      return [];
    }
    
    const parsedData = rawData.map(item => {
      try {
        return JSON.parse(item);
      } catch (error) {
        logger.error('Error parsing history record', { error: error.message, item });
        return null;
      }
    }).filter(item => item !== null);
    
    return parsedData;
  } catch (error) {
    logger.error('Error getting history batch for BigQuery', { error: error.message });
    throw error;
  }
};

/**
 * Remover registros procesados del historial global
 * @param {number} count - Número de registros a remover desde el inicio
 * @returns {Promise<void>}
 */
export const removeProcessedHistoryRecords = async (count) => {
  try {
    await redisIOClient.ltrim('gps:history:global', count, -1);
    logger.info('Removed processed history records', { count });
  } catch (error) {
    logger.error('Error removing processed history records', { error: error.message });
    throw error;
  }
};

// import { Queue, Worker } from 'bullmq';
// import config from '../config/config.js';
// import logger from '../utils/logger.js';
// import { decompressData } from '../utils/compression.js';
// import redisIOClient from '../config/redisIO.js';

// // Crear cola para datos históricos
// export const historicalQueue = new Queue('gps-historical-batch', {
//   connection: redisIOClient,
//   defaultJobOptions: {
//     removeOnComplete: 100,
//     removeOnFail: 50,
//     attempts: 3,
//     backoff: {
//       type: 'exponential',
//       delay: 2000,
//     },
//   },
// });

// // Crear cola para últimas posiciones
// export const latestQueue = new Queue('gps-latest-batch', {
//   connection: redisIOClient,
//   defaultJobOptions: {
//     removeOnComplete: 50,
//     removeOnFail: 25,
//     attempts: 3,
//     backoff: {
//       type: 'exponential',
//       delay: 1000,
//     },
//   },
// });

// // Worker para procesar lotes históricos
// export const historicalWorker = new Worker(
//   'gps-historical-batch',
//   async (job) => {
//     try {
//       const { batchId, data, count, timestamp } = job.data;
      
//       // Descomprimir el lote de datos GPS
//       const buffer = Buffer.from(data, 'base64');
//       const decompressedBatch = await decompressData(buffer);

//       logger.info('Processing historical GPS batch', {
//         jobId: job.id,
//         batchId,
//         count,
//         timestamp
//       });

//       // Procesar cada posición en el lote
//       const results = [];
//       for (const position of decompressedBatch) {
//         try {
//           const deviceId = position.id;
          
//           // Guardar en Redis como histórico (append)
//           const historyKey = `gps:history:${deviceId}`;
//           const historyValue = JSON.stringify({
//             lat: position.lat,
//             lng: position.lng,
//             timestamp: position.timestamp.toISOString ? position.timestamp.toISOString() : position.timestamp,
//             receivedAt: position.receivedAt.toISOString ? position.receivedAt.toISOString() : position.receivedAt
//           });

//           await redisIOClient.rpush(historyKey, historyValue);
          
//           results.push({
//             deviceId,
//             processed: true,
//             timestamp: position.timestamp
//           });

//           logger.debug('Historical position processed', {
//             deviceId,
//             lat: position.lat,
//             lng: position.lng
//           });

//         } catch (error) {
//           logger.error('Error processing single position in historical batch', {
//             error: error.message,
//             position: position
//           });
//           results.push({
//             deviceId: position.id,
//             processed: false,
//             error: error.message
//           });
//         }
//       }

//       logger.info('Historical GPS batch processed', {
//         jobId: job.id,
//         batchId,
//         totalPositions: count,
//         successfullyProcessed: results.filter(r => r.processed).length,
//         errors: results.filter(r => !r.processed).length
//       });
      
//       return { 
//         success: true, 
//         batchId, 
//         processedCount: results.filter(r => r.processed).length,
//         errorCount: results.filter(r => !r.processed).length,
//         processedAt: new Date().toISOString() 
//       };
      
//     } catch (error) {
//       logger.error('Error processing historical GPS batch', {
//         jobId: job.id,
//         error: error.message,
//         stack: error.stack
//       });
//       throw error;
//     }
//   },
//   {
//     connection: redisIOClient,
//     concurrency: config.queue.concurrency || 5,
//   }
// );

// // Worker para procesar últimas posiciones
// export const latestWorker = new Worker(
//   'gps-latest-batch',
//   async (job) => {
//     try {
//       const { batchId, data, count, timestamp } = job.data;
      
//       // Descomprimir el lote de últimas posiciones
//       const buffer = Buffer.from(data, 'base64');
//       const decompressedBatch = await decompressData(buffer);

//       logger.info('Processing latest GPS positions batch', {
//         jobId: job.id,
//         batchId,
//         count,
//         timestamp
//       });

//       // Procesar cada última posición en el lote
//       const results = [];
//       for (const position of decompressedBatch) {
//         try {
//           const deviceId = position.id;
          
//           // Guardar en Redis como última posición (sobrescribe)
//           const lastPositionKey = `gps:last:${deviceId}`;
//           const lastPositionData = {
//             id: position.id,
//             lat: position.lat,
//             lng: position.lng,
//             timestamp: position.timestamp.toISOString ? position.timestamp.toISOString() : position.timestamp,
//             receivedAt: position.receivedAt.toISOString ? position.receivedAt.toISOString() : position.receivedAt,
//             updatedAt: new Date().toISOString()
//           };

//           await redisIOClient.hset(lastPositionKey, lastPositionData);
          
//           results.push({
//             deviceId,
//             processed: true,
//             timestamp: position.timestamp
//           });

//           logger.debug('Latest position processed', {
//             deviceId,
//             lat: position.lat,
//             lng: position.lng
//           });

//         } catch (error) {
//           logger.error('Error processing single position in latest batch', {
//             error: error.message,
//             position: position
//           });
//           results.push({
//             deviceId: position.id,
//             processed: false,
//             error: error.message
//           });
//         }
//       }

//       logger.info('Latest GPS positions batch processed', {
//         jobId: job.id,
//         batchId,
//         totalPositions: count,
//         successfullyProcessed: results.filter(r => r.processed).length,
//         errors: results.filter(r => !r.processed).length
//       });
      
//       return { 
//         success: true, 
//         batchId, 
//         processedCount: results.filter(r => r.processed).length,
//         errorCount: results.filter(r => !r.processed).length,
//         processedAt: new Date().toISOString() 
//       };
      
//     } catch (error) {
//       logger.error('Error processing latest GPS positions batch', {
//         jobId: job.id,
//         error: error.message,
//         stack: error.stack
//       });
//       throw error;
//     }
//   },
//   {
//     connection: redisIOClient,
//     concurrency: config.queue.concurrency || 3,
//   }
// );

// // Event handlers para cola histórica
// historicalQueue.on('completed', (job, result) => {
//   logger.info('Historical batch job completed', {
//     jobId: job.id,
//     batchId: result.batchId,
//     processedCount: result.processedCount
//   });
// });

// historicalQueue.on('failed', (job, err) => {
//   logger.error('Historical batch job failed', {
//     jobId: job.id,
//     error: err.message,
//     attempts: job.attemptsMade
//   });
// });

// // Event handlers para cola de últimas posiciones
// latestQueue.on('completed', (job, result) => {
//   logger.info('Latest positions batch job completed', {
//     jobId: job.id,
//     batchId: result.batchId,
//     processedCount: result.processedCount
//   });
// });

// latestQueue.on('failed', (job, err) => {
//   logger.error('Latest positions batch job failed', {
//     jobId: job.id,
//     error: err.message,
//     attempts: job.attemptsMade
//   });
// });

// // Event handlers para workers
// historicalWorker.on('completed', (job, result) => {
//   logger.debug('Historical worker completed job', {
//     jobId: job.id,
//     batchId: result.batchId
//   });
// });

// historicalWorker.on('failed', (job, err) => {
//   logger.error('Historical worker failed', {
//     jobId: job.id,
//     error: err.message,
//     attempts: job.attemptsMade
//   });
// });

// latestWorker.on('completed', (job, result) => {
//   logger.debug('Latest worker completed job', {
//     jobId: job.id,
//     batchId: result.batchId
//   });
// });

// latestWorker.on('failed', (job, err) => {
//   logger.error('Latest worker failed', {
//     jobId: job.id,
//     error: err.message,
//     attempts: job.attemptsMade
//   });
// });

// /**
//  * Agregar lote de datos GPS históricos a la cola
//  * @param {Object} data - Datos del lote
//  * @returns {Promise<Object>} Información del job
//  */
// export const addToHistoricalQueue = async (data) => {
//   try {
//     const job = await historicalQueue.add('process-gps-historical-batch', data, {
//       priority: 2, // Prioridad media para datos históricos
//       delay: 0,
//     });
    
//     logger.debug('GPS historical batch added to queue', {
//       jobId: job.id,
//       batchId: data.batchId,
//       count: data.count
//     });
    
//     return job;
//   } catch (error) {
//     logger.error('Error adding historical batch to queue', {
//       error: error.message,
//       data: data
//     });
//     throw error;
//   }
// };

// /**
//  * Agregar lote de últimas posiciones GPS a la cola
//  * @param {Object} data - Datos del lote
//  * @returns {Promise<Object>} Información del job
//  */
// export const addToLatestQueue = async (data) => {
//   try {
//     const job = await latestQueue.add('process-gps-latest-batch', data, {
//       priority: 1, // Alta prioridad para últimas posiciones
//       delay: 0,
//     });
    
//     logger.debug('GPS latest positions batch added to queue', {
//       jobId: job.id,
//       batchId: data.batchId,
//       count: data.count
//     });
    
//     return job;
//   } catch (error) {
//     logger.error('Error adding latest batch to queue', {
//       error: error.message,
//       data: data
//     });
//     throw error;
//   }
// };

// /**
//  * Obtener estadísticas de las colas
//  * @returns {Promise<Object>} Estadísticas de las colas
//  */
// export const getQueuesStats = async () => {
//   try {
//     const [historicalStats, latestStats] = await Promise.all([
//       getQueueStats(historicalQueue),
//       getQueueStats(latestQueue)
//     ]);
    
//     return {
//       historical: historicalStats,
//       latest: latestStats
//     };
//   } catch (error) {
//     logger.error('Error getting queues stats', { error: error.message });
//     throw error;
//   }
// };

// /**
//  * Obtener estadísticas de una cola específica
//  * @param {Queue} queue - Cola a consultar
//  * @returns {Promise<Object>} Estadísticas de la cola
//  */
// const getQueueStats = async (queue) => {
//   try {
//     const waiting = await queue.getWaiting();
//     const active = await queue.getActive();
//     const completed = await queue.getCompleted();
//     const failed = await queue.getFailed();
    
//     return {
//       waiting: waiting.length,
//       active: active.length,
//       completed: completed.length,
//       failed: failed.length
//     };
//   } catch (error) {
//     logger.error('Error getting queue stats', { error: error.message });
//     throw error;
//   }
// };

// /**
//  * Limpiar trabajos completados y fallidos
//  * @param {number} maxCompleted - Máximo de trabajos completados a mantener
//  * @param {number} maxFailed - Máximo de trabajos fallidos a mantener
//  */
// export const cleanQueues = async (maxCompleted = 50, maxFailed = 25) => {
//   try {
//     await Promise.all([
//       historicalQueue.clean(0, maxCompleted, 'completed'),
//       historicalQueue.clean(0, maxFailed, 'failed'),
//       latestQueue.clean(0, maxCompleted, 'completed'),
//       latestQueue.clean(0, maxFailed, 'failed')
//     ]);
    
//     logger.info('Queues cleaned', {
//       maxCompleted,
//       maxFailed
//     });
//   } catch (error) {
//     logger.error('Error cleaning queues', { error: error.message });
//     throw error;
//   }
// };