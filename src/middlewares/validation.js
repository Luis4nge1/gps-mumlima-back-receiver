import { gpsPositionSchema, batchGpsPositionsSchema } from '../config/schemas.js';
import { AppError } from '../errors/AppError.js';
import logger from '../utils/logger.js';

/**
 * Validate GPS position data
 */
const validateGpsPosition = (req, res, next) => {
  const { error, value } = gpsPositionSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errorMessages = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    logger.warn('GPS position validation failed', {
      errors: errorMessages,
      body: req.body
    });
    
    return next(new AppError('Validation failed', 400, errorMessages));
  }
  
  req.body = value;
  next();
};

/**
 * Validate batch GPS positions data
 */
const validateBatchPositions = (req, res, next) => {
  const { error, value } = batchGpsPositionsSchema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true
  });
  
  if (error) {
    const errorMessages = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message
    }));
    
    logger.warn('Batch GPS positions validation failed', {
      errors: errorMessages,
      body: req.body
    });
    
    return next(new AppError('Validation failed', 400, errorMessages));
  }
  
  req.body = value;
  next();
};

export {
  validateGpsPosition,
  validateBatchPositions
};