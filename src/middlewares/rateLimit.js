import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import redisClient from '../config/redis.js';
import config from '../config/config.js';
import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';

/**
 * Custom key generator for device-based rate limiting
 */
const deviceKeyGenerator = (req) => {
  const deviceId = req.body?.id || req.params?.id || 'unknown';
  return `${config.redis_prefixes.rateLimit}${deviceId}`;
};

/**
 * Rate limiting middleware for GPS positions per device
 */
const deviceRateLimit = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: config.redis_prefixes.rateLimit,
  }),
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  keyGenerator: deviceKeyGenerator,
  message: {
    success: false,
    error: 'Rate limit exceeded',
    message: `Too many requests from this device. Please wait ${config.rateLimit.windowMs / 1000} seconds before sending another position.`,
    retryAfter: config.rateLimit.windowMs / 1000
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => {
    const deviceId = req.body?.id || req.params?.id || 'unknown';
        
    logger.warn('Rate limit exceeded for device', {
      deviceId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      windowMs: config.rateLimit.windowMs,
      maxRequests: config.rateLimit.maxRequests
    });
        
    const error = new AppError(
      'Rate limit exceeded for this device',
      429,
      {
        deviceId,
        windowMs: config.rateLimit.windowMs,
        maxRequests: config.rateLimit.maxRequests,
        retryAfter: config.rateLimit.windowMs / 1000
      }
    );
        
    next(error);
  },
  skip: (req) => {
    // Skip rate limiting for batch endpoints (they have their own logic)
    return req.path.includes('/batch');
  }
});

export {
  deviceRateLimit
};