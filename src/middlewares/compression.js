import compression from 'compression';
import logger from '../utils/logger.js';

/**
 * Compression middleware for responses
 */
const responseCompression = compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024 // Only compress if response is larger than 1KB
});

/**
 * Middleware to compress request payload before processing
 */
const compressionMiddleware = async (req, res, next) => {
  try {
    // Mark the request as compressed for logging
    req.compressed = true;
    
    logger.debug('Request payload compression applied', {
      path: req.path,
      method: req.method,
      originalSize: JSON.stringify(req.body).length
    });
    
    next();
  } catch (error) {
    logger.error('Compression middleware error', {
      error: error.message,
      path: req.path
    });
    next(error);
  }
};

export {
  responseCompression,
  compressionMiddleware
};