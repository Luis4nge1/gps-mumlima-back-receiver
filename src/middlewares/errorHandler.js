import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error caught by global handler', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new AppError(message, 404);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = new AppError(message, 400);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new AppError(message, 400);
  }

  // Redis connection error
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    error = new AppError('Database connection failed', 503);
  }

  // Rate limit error
  if (err.statusCode === 429) {
    return res.status(429).json({
      success: false,
      error: 'Vehicle Rate limit exceeded',
      message: err.message,
      service: 'vehicle-gps',
      retryAfter: err.details?.retryAfter
    });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Internal Server Error',
    service: 'vehicle-gps',
    ...(process.env.NODE_ENV === 'development' && { 
      stack: error.stack,
      details: error.details 
    }),
    ...(error.details && { details: error.details })
  });
};

/**
 * Not found handler middleware
 */
const notFoundHandler = (req, res, next) => {
  const message = `Route ${req.originalUrl} not found`;
  logger.warn('Route not found', {
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    servicec: "vehicle-gps"
  });
  
  const error = new AppError(message, 404);
  next(error);
};

export {
  errorHandler,
  notFoundHandler
};