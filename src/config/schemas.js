import Joi from 'joi';

export const gpsPositionSchema = Joi.object({
  id: Joi.alternatives().try(
    Joi.string().min(1).max(50),
    Joi.number().integer().positive()
  ).required()
  .messages({
    'any.required': 'Device ID is required',
    'string.min': 'Device ID must be at least 1 character',
    'string.max': 'Device ID must not exceed 50 characters',
    'number.positive': 'Device ID must be a positive number'
  }),
  
  lat: Joi.number()
    .min(-90)
    .max(90)
    .required()
    .messages({
      'any.required': 'Latitude is required',
      'number.base': 'Latitude must be a number',
      'number.min': 'Latitude must be between -90 and 90 degrees',
      'number.max': 'Latitude must be between -90 and 90 degrees'
    }),
  
  lng: Joi.number()
    .min(-180)
    .max(180)
    .required()
    .messages({
      'any.required': 'Longitude is required',
      'number.base': 'Longitude must be a number',
      'number.min': 'Longitude must be between -180 and 180 degrees',
      'number.max': 'Longitude must be between -180 and 180 degrees'
    }),
  
  timestamp: Joi.date()
    .iso()
    .default(() => new Date())
    .messages({
      'date.base': 'Timestamp must be a valid date',
      'date.format': 'Timestamp must be in ISO format'
    })
});

export const batchGpsPositionsSchema = Joi.object({
  positions: Joi.array()
    .items(gpsPositionSchema)
    .min(1)
    .max(100)
    .required()
    .messages({
      'array.min': 'At least one position is required',
      'array.max': 'Maximum 100 positions allowed per batch',
      'any.required': 'Positions array is required'
    })
});