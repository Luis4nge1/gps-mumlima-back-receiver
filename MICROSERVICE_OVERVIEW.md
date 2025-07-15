# GPS Receiver Microservice - Resumen Ejecutivo

## 🎯 Propósito del Microservicio

Este microservicio está diseñado específicamente para **recibir datos GPS y almacenarlos eficientemente en Redis** con dos formatos de almacenamiento distintos. Es parte de una arquitectura de microservicios donde cada servicio tiene una responsabilidad específica.

## 📋 Responsabilidades Específicas

### ✅ Lo que HACE este microservicio:
- **Recibe datos GPS** vía API REST (individual o por lotes)
- **Valida y normaliza** los datos GPS recibidos
- **Detecta duplicados** para evitar datos redundantes
- **Procesa por lotes** para eficiencia (cada 5-10 segundos)
- **Almacena en Redis** en dos formatos específicos:
  - **Historial Global**: Lista completa de todos los datos GPS
  - **Últimas Posiciones**: Solo la posición más reciente de cada dispositivo
- **Proporciona APIs** para consultar las últimas posiciones
- **Monitorea su propio estado** con health checks y métricas

### ❌ Lo que NO hace este microservicio:
- **No procesa datos para BigQuery** (eso lo hará otro microservicio)
- **No hace análisis de datos** (solo almacenamiento)
- **No envía notificaciones** (solo recibe y almacena)
- **No maneja autenticación compleja** (microservicio interno)

## 🏗️ Arquitectura de Almacenamiento

### Formato 1: Historial Global
```
Redis Key: gps:history:global
Tipo: LIST (FIFO)
Propósito: Almacenar TODOS los datos GPS para que otros microservicios los procesen
Estructura: JSON strings con toda la información GPS
```

### Formato 2: Últimas Posiciones
```
Redis Key: gps:last:{deviceId}
Tipo: HASH
Propósito: Acceso rápido a la posición MÁS ACTUAL de cada dispositivo
Estructura: Hash con campos lat, lng, timestamp, etc.
```

## 🔄 Flujo de Procesamiento

```
1. GPS Data → API Endpoint
2. Validación y Normalización
3. Detección de Duplicados
4. Acumulación en Lotes (BatchManager)
5. Procesamiento Asíncrono (QueueManager)
6. Almacenamiento Dual en Redis (RedisManager)
```

## 📡 APIs Principales

### Recepción de Datos
- `POST /api/gps/position` - Una posición GPS
- `POST /api/gps/batch` - Múltiples posiciones GPS

### Consulta de Datos
- `GET /api/gps/device/{id}/last` - Última posición de un dispositivo
- `POST /api/gps/devices/last-positions` - Múltiples últimas posiciones

### Monitoreo
- `GET /api/gps/health` - Estado del microservicio
- `GET /api/gps/stats` - Estadísticas detalladas

## 🔗 Integración con Otros Microservicios

### Microservicio de BigQuery (Ejemplo)
```javascript
// Otro microservicio puede leer directamente de Redis
const redis = require('redis').createClient();

// Obtener datos históricos para procesar
const batchData = await redis.lrange('gps:history:global', 0, 999);

// Procesar y enviar a BigQuery
const processedData = batchData.map(item => JSON.parse(item));
await sendToBigQuery(processedData);

// Remover datos procesados
await redis.ltrim('gps:history:global', 1000, -1);
```

### Microservicio de Alertas (Ejemplo)
```javascript
// Otro microservicio puede consultar últimas posiciones
const lastPosition = await redis.hgetall('gps:last:vehicle_123');

if (isOutOfBounds(lastPosition)) {
  await sendAlert(lastPosition);
}
```

## ⚙️ Configuración Clave

```env
# Procesamiento por lotes
BATCH_INTERVAL=10000          # Procesar cada 10 segundos
BATCH_MAX_SIZE=100           # O cuando llegue a 100 elementos

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Detección de duplicados
DUPLICATE_TIME_THRESHOLD=1000     # 1 segundo
DUPLICATE_COORDINATE_THRESHOLD=0.0001  # ~10 metros
```

## 🚀 Escalabilidad

### Horizontal
- **Múltiples instancias** del microservicio pueden ejecutarse simultáneamente
- **Redis compartido** actúa como almacén centralizado
- **BullMQ** distribuye el trabajo entre workers

### Vertical
- **Configuración de concurrencia** por tipo de cola
- **Tamaños de lote ajustables** según carga
- **Compresión de datos** para optimizar memoria

## 📊 Métricas y Monitoreo

El microservicio proporciona métricas detalladas:
- Posiciones GPS procesadas
- Duplicados detectados
- Errores de procesamiento
- Tamaños de lotes actuales
- Estado de las colas
- Utilización de Redis

## 🔧 Casos de Uso Típicos

### 1. Aplicación de Tracking en Tiempo Real
```javascript
// Enviar posición GPS
await fetch('/api/gps/position', {
  method: 'POST',
  body: JSON.stringify({
    id: 'vehicle_123',
    lat: 40.7128,
    lng: -74.0060,
    timestamp: new Date().toISOString()
  })
});

// Consultar última posición
const response = await fetch('/api/gps/device/vehicle_123/last');
const position = await response.json();
```

### 2. Sistema de Flotillas
```javascript
// Enviar múltiples posiciones
await fetch('/api/gps/batch', {
  method: 'POST',
  body: JSON.stringify({
    positions: [
      { id: 'truck_001', lat: 40.7128, lng: -74.0060 },
      { id: 'truck_002', lat: 40.7589, lng: -73.9851 },
      // ... más posiciones
    ]
  })
});

// Consultar todas las últimas posiciones
const response = await fetch('/api/gps/devices/last-positions', {
  method: 'POST',
  body: JSON.stringify({
    deviceIds: ['truck_001', 'truck_002', 'truck_003']
  })
});
```

## 🎯 Beneficios Clave

1. **Especialización**: Hace una cosa y la hace muy bien
2. **Eficiencia**: Procesamiento por lotes optimizado
3. **Confiabilidad**: Detección de duplicados y manejo de errores
4. **Escalabilidad**: Diseñado para manejar grandes volúmenes
5. **Integración**: Fácil acceso para otros microservicios
6. **Monitoreo**: Observabilidad completa del sistema

## 🔄 Ciclo de Vida de los Datos

```
GPS Device → HTTP Request → Validation → Batch Processing → Redis Storage
                                                                ↓
                                                    Dual Format Storage:
                                                    ├── Complete History
                                                    └── Latest Positions
                                                                ↓
                                            Available for Other Microservices
```

Este microservicio actúa como el **punto de entrada centralizado** para todos los datos GPS en tu arquitectura de microservicios, proporcionando almacenamiento eficiente y acceso optimizado para diferentes casos de uso.