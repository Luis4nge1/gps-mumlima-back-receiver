# GPS Receiver Microservice - Arquitectura Modular

Un microservicio modular y escalable para recibir y almacenar eficientemente datos GPS en Redis con almacenamiento dual: historial global completo y últimas posiciones sin duplicados.

## 🚀 Características Principales

- **Arquitectura Modular**: Componentes desacoplados y reutilizables
- **Procesamiento por Lotes**: Eficiente manejo de grandes volúmenes de datos
- **Almacenamiento Dual**: 
  - Historial global completo (para otros microservicios)
  - Últimas posiciones por dispositivo (tiempo real)
- **Detección de Duplicados**: Filtrado inteligente de datos redundantes
- **Escalabilidad Horizontal**: Múltiples instancias con Redis compartido
- **Monitoreo Completo**: Métricas detalladas y health checks
- **Compresión de Datos**: Optimización de almacenamiento y transferencia

## 📋 Requisitos

- Node.js 18+
- Redis 6+
- npm o yarn

## 🛠️ Instalación

```bash
# Clonar el repositorio
git clone <repository-url>
cd gps-receiver-service

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu configuración

# Iniciar Redis (si no está ejecutándose)
redis-server

# Iniciar el servicio
npm start
```

## ⚙️ Configuración

### Variables de Entorno Principales

```env
# Servidor
PORT=3000
NODE_ENV=development

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Procesamiento por Lotes
BATCH_INTERVAL=10000          # 10 segundos
BATCH_MAX_SIZE=100           # Máximo elementos por lote

# Colas
QUEUE_CONCURRENCY=5          # Workers concurrentes
HISTORICAL_QUEUE_CONCURRENCY=5
LATEST_QUEUE_CONCURRENCY=3

# Limpieza
MAX_HISTORY_ENTRIES=100000   # Máximo registros en historial
CLEANUP_ENABLED=true
```

Ver `.env.example` para configuración completa.

## 🔄 Migración desde Sistema Anterior

Si tienes datos del sistema anterior, usa el script de migración:

```bash
# Migrar datos existentes
node scripts/migrate-to-modular.js

# Migrar y limpiar datos antiguos
node scripts/migrate-to-modular.js --cleanup
```

## 📡 API Endpoints

### Procesamiento GPS

#### Enviar Posición Individual
```bash
POST /api/gps/position
Content-Type: application/json

{
  "id": "device_001",
  "lat": 40.7128,
  "lng": -74.0060,
  "timestamp": "2024-01-01T12:00:00Z",
  "speed": 50,
  "heading": 180,
  "altitude": 100,
  "accuracy": 5
}
```

#### Enviar Lote de Posiciones
```bash
POST /api/gps/batch
Content-Type: application/json

{
  "positions": [
    {
      "id": "device_001",
      "lat": 40.7128,
      "lng": -74.0060,
      "timestamp": "2024-01-01T12:00:00Z"
    },
    {
      "id": "device_002",
      "lat": 40.7589,
      "lng": -73.9851,
      "timestamp": "2024-01-01T12:00:05Z"
    }
  ]
}
```

### Consulta de Datos

#### Última Posición de un Dispositivo
```bash
GET /api/gps/device/{deviceId}/last
```

#### Múltiples Últimas Posiciones
```bash
POST /api/gps/devices/last-positions
Content-Type: application/json

{
  "deviceIds": ["device_001", "device_002", "device_003"]
}
```



### Monitoreo y Gestión

#### Estado de Salud
```bash
GET /api/gps/health
```

#### Estadísticas del Sistema
```bash
GET /api/gps/stats
```

#### Forzar Procesamiento de Lotes
```bash
POST /api/gps/force-batch-processing
```

#### Limpieza del Sistema
```bash
POST /api/gps/cleanup
```

## 🧪 Ejemplos de Uso

### Ejecutar Ejemplo Completo
```bash
npm run example
```

### Scripts Útiles
```bash
# Ver estado de salud
npm run health

# Ver estadísticas
npm run stats

# Realizar limpieza
npm run cleanup
```

### Ejemplo Programático

```javascript
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000/api/gps';

// Enviar posición GPS
const response = await fetch(`${BASE_URL}/position`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'device_001',
    lat: 40.7128,
    lng: -74.0060,
    timestamp: new Date().toISOString()
  })
});

const result = await response.json();
console.log('Resultado:', result);

// Obtener última posición
const lastPosition = await fetch(`${BASE_URL}/device/device_001/last`);
const position = await lastPosition.json();
console.log('Última posición:', position.data);
```

## 🏗️ Arquitectura

### Módulos del Core

- **GpsDataProcessor**: Validación y normalización de datos
- **BatchManager**: Gestión de lotes para procesamiento eficiente
- **QueueManager**: Colas BullMQ para procesamiento asíncrono
- **RedisManager**: Almacenamiento dual en Redis
- **EventBus**: Comunicación entre módulos

### Flujo de Datos

```
GPS Data → Processor → BatchManager → QueueManager → RedisManager
                                                          ↓
                                                    Redis Storage:
                                                    ├── gps:history:global
                                                    └── gps:last:{deviceId}
```

### Formatos de Almacenamiento

#### Historial Global (para otros microservicios)
```redis
Key: gps:history:global
Type: LIST
Data: JSON strings con todos los datos GPS
```

#### Últimas Posiciones (sin duplicados)
```redis
Key: gps:last:{deviceId}
Type: HASH
Data: Última posición de cada dispositivo
```

## 📊 Monitoreo

### Métricas Disponibles

- Posiciones procesadas
- Duplicados detectados
- Errores de procesamiento
- Tamaños de lotes
- Estados de colas
- Estadísticas de almacenamiento

### Health Check

El endpoint `/api/gps/health` proporciona:

- Estado general del sistema
- Estado de componentes individuales
- Métricas de rendimiento
- Tamaños de colas y lotes

## 🔧 Desarrollo

### Estructura del Proyecto

```
src/
├── core/                 # Módulos principales
│   ├── processors/       # Procesamiento de datos
│   ├── batch/           # Gestión de lotes
│   ├── queues/          # Gestión de colas
│   ├── storage/         # Almacenamiento Redis
│   └── events/          # Bus de eventos
├── services/            # Servicios de aplicación
├── controllers/         # Controladores HTTP
├── config/             # Configuración
├── utils/              # Utilidades
└── validators/         # Validadores
```

### Ejecutar en Desarrollo

```bash
# Modo desarrollo con recarga automática
npm run dev

# Ver logs en tiempo real
tail -f logs/gps-service.log
```

### Testing

```bash
# Ejecutar tests (cuando estén disponibles)
npm test

# Limpiar lotes para testing
curl -X DELETE http://localhost:3000/api/gps/batches
```

## 🚀 Despliegue

### Docker (Recomendado)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Variables de Entorno de Producción

```env
NODE_ENV=production
PORT=3000
REDIS_HOST=redis-server
BATCH_INTERVAL=5000
MAX_HISTORY_ENTRIES=1000000
CLEANUP_ENABLED=true
LOG_LEVEL=info
```

## 🔍 Troubleshooting

### Problemas Comunes

1. **Redis no conecta**: Verificar host, puerto y credenciales
2. **Lotes no se procesan**: Verificar configuración de intervalos
3. **Memoria alta**: Ajustar tamaños de lote y limpieza
4. **Duplicados no detectados**: Verificar configuración de thresholds

### Logs Útiles

```bash
# Ver logs de procesamiento
grep "batch processed" logs/gps-service.log

# Ver errores
grep "ERROR" logs/gps-service.log

# Ver estadísticas de Redis
redis-cli info memory
```

## 📚 Documentación Adicional

- [Arquitectura Detallada](README_ARCHITECTURE.md)
- [Configuración Avanzada](.env.example)
- [Ejemplos de Uso](examples/usage-example.js)
- [Script de Migración](scripts/migrate-to-modular.js)

## 🤝 Contribución

1. Fork el proyecto
2. Crear rama de feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -am 'Agregar nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Crear Pull Request

## 📄 Licencia

ISC License - ver archivo LICENSE para detalles.

## 🆘 Soporte

Para soporte y preguntas:

1. Revisar documentación y ejemplos
2. Verificar logs del sistema
3. Usar endpoint de health check
4. Crear issue en el repositorio

---

**Nota**: Este microservicio está especializado únicamente en recibir y almacenar datos GPS en Redis. Otros microservicios se encargarán del procesamiento adicional como BigQuery, análisis, alertas, etc. La arquitectura modular permite fácil escalado y mantenimiento.