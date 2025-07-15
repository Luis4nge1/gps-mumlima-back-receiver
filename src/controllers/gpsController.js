import express from 'express';
import GpsService from '../services/GpsService.js';
import { getQueuesStats } from '../queues/gpsQueues.js';
import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
import { validateGpsData, validateBatchGpsData } from '../validators/gpsValidator.js';

const router = express.Router();

/**
 * Endpoint para recibir una posición GPS individual
 * POST /api/gps/position
 */
router.post('/position', async (req, res) => {
  try {
    const { id, lat, lng, timestamp } = req.body;
    
    // Validar datos de entrada
    const validationResult = validateGpsData({ id, lat, lng, timestamp });
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GPS data',
        details: validationResult.errors
      });
    }

    // Procesar posición GPS (se encola para batch processing)
    const result = await GpsService.processGpsPosition({
      id,
      lat,
      lng,
      timestamp: timestamp || new Date()
    });

    logger.info('GPS position received', {
      deviceId: id,
      processed: result.processed,
      queued: result.queued,
      duplicate: result.duplicate,
      batchSize: result.batchSize
    });

    res.status(200).json({
      success: true,
      data: {
        deviceId: id,
        processed: result.processed,
        queued: result.queued,
        duplicate: result.duplicate,
        message: result.duplicate ? 'Position was duplicate' : 'Position queued for processing'
      }
    });

  } catch (error) {
    logger.error('Error processing GPS position', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });

    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Endpoint para recibir múltiples posiciones GPS en un lote
 * POST /api/gps/batch
 */
router.post('/batch', async (req, res) => {
  try {
    const { positions } = req.body;
    
    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Positions array is required and must not be empty'
      });
    }

    // Validar datos del lote
    const validationResult = validateBatchGpsData(positions);
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid batch GPS data',
        details: validationResult.errors
      });
    }

    // Procesar lote de posiciones GPS
    const results = await GpsService.processBatchGpsPositions(positions);

    logger.info('GPS batch processed', {
      totalPositions: positions.length,
      processed: results.processed,
      duplicates: results.duplicates,
      errors: results.errors
    });

    res.status(200).json({
      success: true,
      data: {
        totalPositions: positions.length,
        processed: results.processed,
        duplicates: results.duplicates,
        errors: results.errors,
        message: `Processed ${results.processed} positions, ${results.duplicates} duplicates, ${results.errors} errors`
      }
    });

  } catch (error) {
    logger.error('Error processing GPS batch', {
      error: error.message,
      stack: error.stack,
      positionsCount: req.body?.positions?.length
    });

    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Endpoint para obtener la última posición de un dispositivo
 * GET /api/gps/device/:deviceId/last
 */
router.get('/device/:deviceId/last', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Device ID is required'
      });
    }

    const lastPosition = await GpsService.getLastPosition(deviceId);

    if (!lastPosition) {
      return res.status(404).json({
        success: false,
        error: 'No position found for this device'
      });
    }

    res.status(200).json({
      success: true,
      data: lastPosition
    });

  } catch (error) {
    logger.error('Error retrieving last position', {
      error: error.message,
      deviceId: req.params.deviceId
    });

    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Endpoint para obtener estadísticas del sistema
 * GET /api/gps/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const [queueStats, batchStats] = await Promise.all([
      getQueuesStats(),
      GpsService.getBatchStats()
    ]);

    res.status(200).json({
      success: true,
      data: {
        queues: queueStats,
        batches: batchStats,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error retrieving system stats', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Endpoint para forzar el procesamiento de lotes (útil para testing)
 * POST /api/gps/force-batch-processing
 */
router.post('/force-batch-processing', async (req, res) => {
  try {
    await GpsService.forceBatchProcessing();

    logger.info('Batch processing forced');

    res.status(200).json({
      success: true,
      message: 'Batch processing completed'
    });

  } catch (error) {
    logger.error('Error forcing batch processing', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Endpoint para limpiar lotes (útil para testing)
 * DELETE /api/gps/batches
 */
router.delete('/batches', async (req, res) => {
  try {
    GpsService.clearBatches();

    logger.info('Batches cleared');

    res.status(200).json({
      success: true,
      message: 'Batches cleared'
    });

  } catch (error) {
    logger.error('Error clearing batches', {
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Endpoint de health check
 * GET /api/gps/health
 */
router.get('/health', async (req, res) => {
  try {
    const batchStats = GpsService.getBatchStats();
    const queueStats = await getQueuesStats();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      batches: {
        historical: batchStats.historicalBatchSize,
        latest: batchStats.latestPositionsCount
      },
      queues: {
        historical: {
          waiting: queueStats.historical.waiting,
          active: queueStats.historical.active
        },
        latest: {
          waiting: queueStats.latest.waiting,
          active: queueStats.latest.active
        }
      }
    };

    res.status(200).json({
      success: true,
      data: health
    });

  } catch (error) {
    logger.error('Health check failed', {
      error: error.message
    });

    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;


// import express from 'express';
// const router = express.Router();

// import gpsService from '../services/gpsService.js';
// import { validateGpsPosition, validateBatchPositions } from '../middlewares/validation.js';
// import { deviceRateLimit } from '../middlewares/rateLimit.js';
// import { compressionMiddleware } from '../middlewares/compression.js';
// import logger from '../utils/logger.js';
// import { AppError } from '../errors/AppError.js';

// /**
//  * POST /api/gps/position
//  * Receive single GPS position
//  */
// router.post('/position', 
//   validateGpsPosition,
//   deviceRateLimit,
//   compressionMiddleware,
//   async (req, res, next) => {
//     try {
//       const { id, lat, lng, timestamp } = req.body;
      
//       const result = await gpsService.processGpsPosition({
//         id: String(id),
//         lat: parseFloat(lat),
//         lng: parseFloat(lng),
//         timestamp: new Date(timestamp)
//       });
      
//       logger.info('GPS position processed successfully', {
//         deviceId: id,
//         lat,
//         lng,
//         timestamp,
//         processed: result.processed,
//         queued: result.queued
//       });
      
//       res.status(201).json({
//         success: true,
//         message: 'GPS position processed successfully',
//         data: {
//           deviceId: id,
//           processed: result.processed,
//           queued: result.queued,
//           duplicate: result.duplicate || false
//         }
//       });
      
//     } catch (error) {
//       logger.error('Error processing GPS position', {
//         error: error.message,
//         deviceId: req.body?.id,
//         stack: error.stack
//       });
//       next(error);
//     }
//   }
// );

// /**
//  * POST /api/gps/batch
//  * Receive batch of GPS positions (prepared for future use)
//  */
// router.post('/batch',
//   validateBatchPositions,
//   async (req, res, next) => {
//     try {
//       const { positions } = req.body;
      
//       const results = await gpsService.processBatchGpsPositions(positions);
      
//       logger.info('GPS batch processed successfully', {
//         totalPositions: positions.length,
//         processed: results.processed,
//         duplicates: results.duplicates,
//         errors: results.errors
//       });
      
//       res.status(201).json({
//         success: true,
//         message: 'GPS batch processed successfully',
//         data: {
//           totalPositions: positions.length,
//           processed: results.processed,
//           duplicates: results.duplicates,
//           errors: results.errors
//         }
//       });
      
//     } catch (error) {
//       logger.error('Error processing GPS batch', {
//         error: error.message,
//         positionsCount: req.body?.positions?.length,
//         stack: error.stack
//       });
//       next(error);
//     }
//   }
// );

// /**
//  * GET /api/gps/position/:id
//  * Get last known position for a device
//  */
// router.get('/position/:id', async (req, res, next) => {
//   try {
//     const { id } = req.params;
    
//     const position = await gpsService.getLastPosition(String(id));
    
//     if (!position) {
//       throw new AppError('Position not found for this device', 404);
//     }
    
//     res.json({
//       success: true,
//       data: position
//     });
    
//   } catch (error) {
//     logger.error('Error retrieving last position', {
//       error: error.message,
//       deviceId: req.params?.id,
//       stack: error.stack
//     });
//     next(error);
//   }
// });

// export default router;