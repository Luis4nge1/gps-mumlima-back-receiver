import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Import configurations and utilities
import config from './config/config.js';
import logger from './utils/logger.js';
import redisClient from './config/redis.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { requestLogger } from './middlewares/requestLogger.js';

// Import routes
import gpsRoutes from './controllers/gpsController.js';
import healthRoutes from './controllers/healthController.js';

// Import new modular service
import GpsProcessingService from './services/GpsProcessingService.js';

// Initialize express app
const app = express();

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors());
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(requestLogger);

// Global rate limiting (fallback)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  //keyGenerator: (req) => req.body.deviceId,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Routes
app.use('/api/gps', gpsRoutes);
app.use('/health', healthRoutes);
app.use('/metrics', healthRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Vehicle GPS Service',
    version: '1.0.0',
    status: 'running',
    description: 'Microservice for receiving and storing vehicle GPS coordinates',
    endpoints: {
      health: '/health',
      metrics: '/metrics',
      api: '/api/mobile'
    }
  });
});

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Initialize GPS Processing Service
async function initializeServices() {
  try {
    await GpsProcessingService.initialize();
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize services', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  
  try {
    // Shutdown GPS Processing Service first
    await GpsProcessingService.shutdown();
    
    // Then close Redis connection
    await redisClient.quit();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const PORT = config.server?.port || config.port || 3000;
const HOST = config.server?.host || config.host || 'localhost';

// Start server and initialize services
app.listen(PORT, HOST, async () => {
  logger.info(`GPS Receiver Service running on port ${PORT}`, {
    port: PORT,
    environment: config.environment || config.nodeEnv,
    service: 'vehicle-gps',
    redis: {
      host: config.redis.host,
      port: config.redis.port
    }
  });
  
  // Initialize services after server starts
  await initializeServices();
});

export default app;