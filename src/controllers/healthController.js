import express from 'express';
import promClient from 'prom-client';

import redisClient from '../config/redis.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Prometheus metrics
const register = new promClient.Registry();

// Default metrics
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

const gpsPositionsProcessed = new promClient.Counter({
  name: 'gps_positions_processed_total',
  help: 'Total number of GPS positions processed',
  labelNames: ['device_id'],
  registers: [register]
});

const redisConnectionStatus = new promClient.Gauge({
  name: 'redis_connection_status',
  help: 'Redis connection status (1 = connected, 0 = disconnected)',
  registers: [register]
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        redis: 'unknown',
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      }
    };
    
    // Check Redis connection
    try {
      await redisClient.ping();
      healthCheck.checks.redis = 'connected';
      redisConnectionStatus.set(1);
    } catch (redisError) {
      healthCheck.checks.redis = 'disconnected';
      healthCheck.status = 'unhealthy';
      redisConnectionStatus.set(0);
      logger.error('Redis health check failed', { error: redisError.message });
    }
    
    const statusCode = healthCheck.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(healthCheck);
    
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    logger.error('Error serving metrics', { error: error.message });
    res.status(500).json({ error: 'Unable to serve metrics' });
  }
});

export default router;

export const metrics = {
  httpRequestsTotal,
  gpsPositionsProcessed,
  redisConnectionStatus,
};