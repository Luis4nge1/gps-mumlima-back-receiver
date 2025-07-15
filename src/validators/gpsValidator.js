import config from '../config/config.js';

/**
 * Valida una coordenada de latitud
 * @param {number} lat - Latitud
 * @returns {boolean} True si es válida
 */
const isValidLatitude = (lat) => {
  const numLat = parseFloat(lat);
  return !isNaN(numLat) && 
         numLat >= config.validation.coordinates.minLatitude && 
         numLat <= config.validation.coordinates.maxLatitude;
};

/**
 * Valida una coordenada de longitud
 * @param {number} lng - Longitud
 * @returns {boolean} True si es válida
 */
const isValidLongitude = (lng) => {
  const numLng = parseFloat(lng);
  return !isNaN(numLng) && 
         numLng >= config.validation.coordinates.minLongitude && 
         numLng <= config.validation.coordinates.maxLongitude;
};

/**
 * Valida un ID de dispositivo
 * @param {string} deviceId - ID del dispositivo
 * @returns {boolean} True si es válido
 */
const isValidDeviceId = (deviceId) => {
  if (!deviceId || typeof deviceId !== 'string') {
    return false;
  }
  
  if (deviceId.length > config.validation.deviceId.maxLength) {
    return false;
  }
  
  const pattern = new RegExp(config.validation.deviceId.pattern);
  return pattern.test(deviceId);
};

/**
 * Valida un timestamp
 * @param {string|Date} timestamp - Timestamp
 * @returns {boolean} True si es válido
 */
const isValidTimestamp = (timestamp) => {
  if (!timestamp) {
    return true; // Timestamp es opcional, se usará la fecha actual
  }
  
  let date;
  if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    date = new Date(timestamp);
  }
  
  if (isNaN(date.getTime())) {
    return false;
  }
  
  const now = new Date();
  const maxAge = config.validation.timestamp.maxAge;
  const maxFuture = config.validation.timestamp.maxFuture;
  
  // Verificar que no sea muy antiguo
  if (now.getTime() - date.getTime() > maxAge) {
    return false;
  }
  
  // Verificar que no sea muy futuro
  if (date.getTime() - now.getTime() > maxFuture) {
    return false;
  }
  
  return true;
};

/**
 * Valida los datos GPS de una posición individual
 * @param {Object} gpsData - Datos GPS
 * @param {string} gpsData.id - ID del dispositivo
 * @param {number} gpsData.lat - Latitud
 * @param {number} gpsData.lng - Longitud
 * @param {string|Date} gpsData.timestamp - Timestamp (opcional)
 * @returns {Object} Resultado de validación
 */
export const validateGpsData = (gpsData) => {
  const errors = [];
  
  // Validar que los datos existan
  if (!gpsData || typeof gpsData !== 'object') {
    return {
      isValid: false,
      errors: ['GPS data is required and must be an object']
    };
  }
  
  const { id, lat, lng, timestamp } = gpsData;
  
  // Validar ID del dispositivo
  if (!isValidDeviceId(id)) {
    errors.push('Invalid device ID: must be a string with maximum length of ' + 
                config.validation.deviceId.maxLength + ' characters and match pattern ' + 
                config.validation.deviceId.pattern);
  }
  
  // Validar latitud
  if (lat === undefined || lat === null) {
    errors.push('Latitude is required');
  } else if (!isValidLatitude(lat)) {
    errors.push(`Invalid latitude: must be a number between ${config.validation.coordinates.minLatitude} and ${config.validation.coordinates.maxLatitude}`);
  }
  
  // Validar longitud
  if (lng === undefined || lng === null) {
    errors.push('Longitude is required');
  } else if (!isValidLongitude(lng)) {
    errors.push(`Invalid longitude: must be a number between ${config.validation.coordinates.minLongitude} and ${config.validation.coordinates.maxLongitude}`);
  }
  
  // Validar timestamp (opcional)
  if (timestamp && !isValidTimestamp(timestamp)) {
    errors.push('Invalid timestamp: must be a valid date within the allowed time range');
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
};

/**
 * Valida un lote de datos GPS
 * @param {Array} positions - Array de posiciones GPS
 * @returns {Object} Resultado de validación
 */
export const validateBatchGpsData = (positions) => {
  const errors = [];
  
  // Validar que sea un array
  if (!Array.isArray(positions)) {
    return {
      isValid: false,
      errors: ['Positions must be an array']
    };
  }
  
  // Validar que no esté vacío
  if (positions.length === 0) {
    return {
      isValid: false,
      errors: ['Positions array cannot be empty']
    };
  }
  
  // Validar que no exceda el tamaño máximo del lote
  if (positions.length > config.batch.maxSize) {
    errors.push(`Batch size exceeds maximum allowed: ${positions.length} > ${config.batch.maxSize}`);
  }
  
  // Validar cada posición en el lote
  const positionErrors = [];
  positions.forEach((position, index) => {
    const validationResult = validateGpsData(position);
    if (!validationResult.isValid) {
      positionErrors.push({
        index: index,
        errors: validationResult.errors
      });
    }
  });
  
  // Agregar errores de posiciones individuales
  if (positionErrors.length > 0) {
    errors.push({
      message: 'Invalid positions found in batch',
      positions: positionErrors
    });
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
};

/**
 * Valida y normaliza los datos GPS
 * @param {Object} gpsData - Datos GPS
 * @returns {Object} Datos GPS normalizados
 */
export const normalizeGpsData = (gpsData) => {
  const validationResult = validateGpsData(gpsData);
  
  if (!validationResult.isValid) {
    throw new Error('Invalid GPS data: ' + validationResult.errors.join(', '));
  }
  
  return {
    id: String(gpsData.id).trim(),
    lat: parseFloat(gpsData.lat),
    lng: parseFloat(gpsData.lng),
    timestamp: gpsData.timestamp ? new Date(gpsData.timestamp) : new Date()
  };
};

/**
 * Valida y normaliza un lote de datos GPS
 * @param {Array} positions - Array de posiciones GPS
 * @returns {Array} Array de datos GPS normalizados
 */
export const normalizeBatchGpsData = (positions) => {
  const validationResult = validateBatchGpsData(positions);
  
  if (!validationResult.isValid) {
    throw new Error('Invalid batch GPS data: ' + JSON.stringify(validationResult.errors));
  }
  
  return positions.map(position => normalizeGpsData(position));
};

/**
 * Middleware de validación para Express
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
export const validateGpsMiddleware = (req, res, next) => {
  try {
    const validationResult = validateGpsData(req.body);
    
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GPS data',
        details: validationResult.errors
      });
    }
    
    // Normalizar los datos
    req.body = normalizeGpsData(req.body);
    next();
    
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Error validating GPS data',
      details: error.message
    });
  }
};

/**
 * Middleware de validación para lotes en Express
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware function
 */
export const validateBatchGpsMiddleware = (req, res, next) => {
  try {
    const { positions } = req.body;
    
    if (!positions) {
      return res.status(400).json({
        success: false,
        error: 'Positions array is required'
      });
    }
    
    const validationResult = validateBatchGpsData(positions);
    
    if (!validationResult.isValid) {
      return res.status(400).json({
        success: false,
        error: 'Invalid batch GPS data',
        details: validationResult.errors
      });
    }
    
    // Normalizar los datos
    req.body.positions = normalizeBatchGpsData(positions);
    next();
    
  } catch (error) {
    return res.status(400).json({
      success: false,
      error: 'Error validating batch GPS data',
      details: error.message
    });
  }
};