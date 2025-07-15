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
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Routes
app.use('/api/gps', gpsRoutes);
//app.use('/health', healthRoutes);
//app.use('/metrics', healthRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await redisClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await redisClient.quit();
  process.exit(0);
});

const PORT = config.port || 3000;

app.listen(PORT, () => {
  logger.info(`GPS Receiver Service running on port ${PORT}`, {
    port: PORT,
    environment: config.nodeEnv,
    redis: {
      host: config.redis.host,
      port: config.redis.port
    }
  });
});

export default app;