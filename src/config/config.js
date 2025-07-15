import dotenv from 'dotenv';
dotenv.config();

export default {
  // Configuración de Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
  },

  // Configuración de las colas
  queue: {
    name: process.env.QUEUE_NAME || 'gps-processing',
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY) || 5,
    // Configuración específica para batch processing
    historical: {
      name: 'gps-historical-batch',
      concurrency: parseInt(process.env.HISTORICAL_QUEUE_CONCURRENCY) || 5,
      removeOnComplete: parseInt(process.env.HISTORICAL_REMOVE_ON_COMPLETE) || 100,
      removeOnFail: parseInt(process.env.HISTORICAL_REMOVE_ON_FAIL) || 50,
    },
    latest: {
      name: 'gps-latest-batch',
      concurrency: parseInt(process.env.LATEST_QUEUE_CONCURRENCY) || 3,
      removeOnComplete: parseInt(process.env.LATEST_REMOVE_ON_COMPLETE) || 50,
      removeOnFail: parseInt(process.env.LATEST_REMOVE_ON_FAIL) || 25,
    }
  },

  // Configuración de batch processing
  batch: {
    // Intervalo de procesamiento en milisegundos (5-10 segundos)
    interval: parseInt(process.env.BATCH_INTERVAL) || 10000, // 10 segundos
    
    // Tamaño máximo del lote antes de forzar procesamiento
    maxSize: parseInt(process.env.BATCH_MAX_SIZE) || 100,
    
    // Configuración específica para lotes históricos
    historical: {
      maxSize: parseInt(process.env.HISTORICAL_BATCH_MAX_SIZE) || 150,
      compressionEnabled: process.env.HISTORICAL_COMPRESSION === 'true' || true,
    },
    
    // Configuración específica para lotes de últimas posiciones
    latest: {
      maxSize: parseInt(process.env.LATEST_BATCH_MAX_SIZE) || 50,
      compressionEnabled: process.env.LATEST_COMPRESSION === 'true' || true,
    }
  },

  // Prefijos de Redis
  redis_prefixes: {
    lastPosition: process.env.REDIS_LAST_POSITION_PREFIX || 'gps:last:',
    history: process.env.REDIS_HISTORY_PREFIX || 'gps:history:',
    queue: process.env.REDIS_QUEUE_PREFIX || 'gps:queue:',
  },

  // Configuración del servidor
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || 'localhost',
  },

  // Configuración de logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: process.env.LOG_CONSOLE === 'true' || true,
    enableFile: process.env.LOG_FILE === 'true' || false,
    filename: process.env.LOG_FILENAME || 'gps-service.log',
  },

  // Configuración de compresión
  compression: {
    enabled: process.env.COMPRESSION_ENABLED === 'true' || true,
    level: parseInt(process.env.COMPRESSION_LEVEL) || 6, // 1-9, 6 es el default de zlib
    threshold: parseInt(process.env.COMPRESSION_THRESHOLD) || 1024, // Comprimir solo si es mayor a 1KB
  },

  // Configuración de detección de duplicados
  duplicate: {
    enabled: process.env.DUPLICATE_DETECTION === 'true' || true,
    timeThreshold: parseInt(process.env.DUPLICATE_TIME_THRESHOLD) || 1000, // 1 segundo
    coordinateThreshold: parseFloat(process.env.DUPLICATE_COORDINATE_THRESHOLD) || 0.0001, // ~10 metros
  },

  // Configuración de limpieza automática
  cleanup: {
    enabled: process.env.CLEANUP_ENABLED === 'true' || true,
    interval: parseInt(process.env.CLEANUP_INTERVAL) || 3600000, // 1 hora
    maxHistoryEntries: parseInt(process.env.MAX_HISTORY_ENTRIES) || 1000,
    maxCompletedJobs: parseInt(process.env.MAX_COMPLETED_JOBS) || 100,
    maxFailedJobs: parseInt(process.env.MAX_FAILED_JOBS) || 50,
  },

  // Configuración de métricas y monitoreo
  metrics: {
    enabled: process.env.METRICS_ENABLED === 'true' || true,
    port: parseInt(process.env.METRICS_PORT) || 9090,
    path: process.env.METRICS_PATH || '/metrics',
  },

  // Configuración de rate limiting
  rateLimit: {
    enabled: process.env.RATE_LIMIT_ENABLED === 'true' || true,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 minuto
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
    skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESS === 'true' || false,
  },

  // Configuración de validación
  validation: {
    coordinates: {
      minLatitude: parseFloat(process.env.MIN_LATITUDE) || -90,
      maxLatitude: parseFloat(process.env.MAX_LATITUDE) || 90,
      minLongitude: parseFloat(process.env.MIN_LONGITUDE) || -180,
      maxLongitude: parseFloat(process.env.MAX_LONGITUDE) || 180,
    },
    deviceId: {
      maxLength: parseInt(process.env.MAX_DEVICE_ID_LENGTH) || 50,
      pattern: process.env.DEVICE_ID_PATTERN || '^[a-zA-Z0-9_-]+',
    },
    timestamp: {
      maxAge: parseInt(process.env.MAX_TIMESTAMP_AGE) || 86400000, // 24 horas
      maxFuture: parseInt(process.env.MAX_TIMESTAMP_FUTURE) || 300000, // 5 minutos
    }
  },

  // Configuración de ambiente
  environment: process.env.NODE_ENV || 'development',
  
  // Configuración de salud del sistema
  health: {
    enabled: process.env.HEALTH_CHECK_ENABLED === 'true' || true,
    port: parseInt(process.env.HEALTH_CHECK_PORT) || 8080,
    path: process.env.HEALTH_CHECK_PATH || '/health',
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000,
  }
};