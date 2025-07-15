# Arquitectura Modular GPS Receiver Microservice

## Resumen

Este microservicio ha sido diseñado para ser completamente modular y escalable, enfocado específicamente en recibir datos GPS, procesarlos eficientemente y almacenarlos en Redis en dos formatos distintos:

1. **Historial Global**: Todos los datos GPS se almacenan en una lista global para que otros microservicios puedan acceder y procesarlos
2. **Últimas Posiciones**: Solo la posición más reciente de cada dispositivo GPS (sin duplicados) para consultas en tiempo real

## Arquitectura Modular

### Core Modules (`src/core/`)

#### 1. GpsDataProcessor (`src/core/processors/GpsDataProcessor.js`)
- **Responsabilidad**: Procesamiento, validación y normalización de datos GPS
- **Características**:
  - Validación de coordenadas y timestamps
  - Detección de duplicados en memoria
  - Normalización de formatos de entrada
  - Manejo de metadatos adicionales (velocidad, rumbo, altitud, precisión)

#### 2. BatchManager (`src/core/batch/BatchManager.js`)
- **Responsabilidad**: Gestión de lotes para procesamiento eficiente
- **Características**:
  - Lote histórico: Acumula todas las posiciones GPS
  - Lote de últimas posiciones: Mantiene solo la más reciente por dispositivo
  - Procesamiento automático cada 5-10 segundos (configurable)
  - Procesamiento inmediato al alcanzar tamaño máximo

#### 3. QueueManager (`src/core/queues/QueueManager.js`)
- **Responsabilidad**: Gestión de colas BullMQ para procesamiento asíncrono
- **Características**:
  - Cola histórica: Procesa lotes de historial
  - Cola de últimas posiciones: Procesa últimas posiciones
  - Workers con concurrencia configurable
  - Reintentos automáticos y manejo de errores

#### 4. RedisManager (`src/core/storage/RedisManager.js`)
- **Responsabilidad**: Gestión centralizada de almacenamiento Redis
- **Características**:
  - **Formato 1 - Historial Global**: `gps:history:global` (lista FIFO)
  - **Formato 2 - Últimas Posiciones**: `gps:last:{deviceId}` (hash por dispositivo)
  - Compresión de datos
  - Limpieza automática
  - Acceso directo para otros microservicios

#### 5. EventBus (`src/core/events/EventBus.js`)
- **Responsabilidad**: Comunicación desacoplada entre módulos
- **Características**:
  - Eventos de procesamiento
  - Eventos de colas
  - Eventos de almacenamiento
  - Logging automático de eventos

### Service Layer (`src/services/`)

#### GpsProcessingService (`src/services/GpsProcessingService.js`)
- **Responsabilidad**: Orquestación de todos los módulos del core
- **API Principal**:
  - `processPosition(rawPosition)`: Procesa una posición individual
  - `processBatch(rawPositions)`: Procesa múltiples posiciones
  - `getLastPosition(deviceId)`: Obtiene última posición de un dispositivo
  - `getLastPositions(deviceIds)`: Obtiene múltiples últimas posiciones

## Flujo de Datos

```
GPS Data Input
      ↓
GpsDataProcessor (validación, normalización, detección duplicados)
      ↓
BatchManager (acumulación en lotes)
      ↓ (cada 5-10 segundos)
QueueManager (procesamiento asíncrono)
      ↓
RedisManager (almacenamiento en dos formatos)
      ↓
Redis Storage:
├── gps:history:global (para otros microservicios)
└── gps:last:{deviceId} (últimas posiciones)
```

## Formatos de Almacenamiento Redis

### 1. Historial Global (para otros microservicios)
```redis
Key: gps:history:global
Type: LIST
Structure: JSON strings
Example:
[
  '{"deviceId":"device1","lat":40.7128,"lng":-74.0060,"timestamp":"2024-01-01T12:00:00Z","receivedAt":"2024-01-01T12:00:01Z","batchId":"hist_123","metadata":{}}',
  '{"deviceId":"device2","lat":40.7589,"lng":-73.9851,"timestamp":"2024-01-01T12:00:05Z","receivedAt":"2024-01-01T12:00:06Z","batchId":"hist_123","metadata":{}}'
]
```

### 2. Últimas Posiciones (sin duplicados)
```redis
Key: gps:last:{deviceId}
Type: HASH
Structure:
{
  "deviceId": "device1",
  "lat": "40.7128",
  "lng": "-74.0060",
  "timestamp": "2024-01-01T12:00:00Z",
  "receivedAt": "2024-01-01T12:00:01Z",
  "updatedAt": "2024-01-01T12:00:02Z",
  "metadata": "{\"speed\":50,\"heading\":180}"
}
```

## API Endpoints

### Procesamiento GPS
- `POST /api/gps/position` - Recibe una posición GPS individual
- `POST /api/gps/batch` - Recibe múltiples posiciones GPS

### Consulta de Datos
- `GET /api/gps/device/:deviceId/last` - Última posición de un dispositivo
- `POST /api/gps/devices/last-positions` - Múltiples últimas posiciones

### Gestión del Sistema
- `GET /api/gps/stats` - Estadísticas completas del sistema
- `GET /api/gps/health` - Estado de salud del sistema
- `POST /api/gps/force-batch-processing` - Forzar procesamiento de lotes
- `POST /api/gps/cleanup` - Limpieza del sistema

## Configuración

### Variables de Entorno Principales
```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Batch Processing
BATCH_INTERVAL=10000          # 10 segundos
BATCH_MAX_SIZE=100           # Máximo elementos por lote

# Queue Configuration
QUEUE_CONCURRENCY=5          # Workers concurrentes
HISTORICAL_QUEUE_CONCURRENCY=5
LATEST_QUEUE_CONCURRENCY=3

# Cleanup
MAX_HISTORY_ENTRIES=100000   # Máximo registros en historial global
CLEANUP_ENABLED=true
CLEANUP_INTERVAL=3600000     # 1 hora

# Duplicate Detection
DUPLICATE_DETECTION=true
DUPLICATE_TIME_THRESHOLD=1000     # 1 segundo
DUPLICATE_COORDINATE_THRESHOLD=0.0001  # ~10 metros
```

## Escalabilidad

### Horizontal
- Múltiples instancias del servicio pueden procesar datos simultáneamente
- Redis actúa como almacén centralizado compartido
- BullMQ distribuye trabajos entre workers

### Vertical
- Configuración de concurrencia por tipo de cola
- Tamaños de lote configurables
- Compresión de datos para optimizar memoria

### Monitoreo
- Métricas detalladas por componente
- Health checks granulares
- Eventos centralizados para observabilidad

## Integración con Otros Microservicios

### Acceso Directo a Redis
Otros microservicios pueden acceder directamente a los datos almacenados:

```javascript
// Acceso al historial global completo
const redis = require('redis').createClient();
const historyData = await redis.lrange('gps:history:global', 0, -1);

// Acceso a última posición específica
const lastPosition = await redis.hgetall('gps:last:device_001');

// Acceso a todas las últimas posiciones
const deviceKeys = await redis.keys('gps:last:*');
const pipeline = redis.pipeline();
deviceKeys.forEach(key => pipeline.hgetall(key));
const allLastPositions = await pipeline.exec();
```

### Patrón de Consumo
```javascript
// Microservicio consumidor puede procesar datos en tiempo real
const subscriber = redis.createClient();
subscriber.subscribe('gps:events');
subscriber.on('message', (channel, message) => {
  const event = JSON.parse(message);
  // Procesar evento GPS
});
```

## Ventajas de la Nueva Arquitectura

1. **Modularidad**: Cada componente tiene una responsabilidad específica
2. **Escalabilidad**: Fácil escalado horizontal y vertical
3. **Mantenibilidad**: Código organizado y fácil de mantener
4. **Observabilidad**: Métricas y eventos detallados
5. **Flexibilidad**: Configuración granular por componente
6. **Eficiencia**: Procesamiento por lotes y compresión
7. **Confiabilidad**: Manejo de errores y reintentos automáticos
8. **Separación de Responsabilidades**: Historial vs. últimas posiciones claramente separados

Esta arquitectura está diseñada para manejar grandes volúmenes de datos GPS de manera eficiente, manteniendo la integridad de los datos y proporcionando las dos vistas necesarias: historial completo para análisis y últimas posiciones para aplicaciones en tiempo real.