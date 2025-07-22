# 🛰️ GPS Receiver Service

Microservicio para recibir y almacenar datos GPS en Redis con procesamiento por lotes y detección de duplicados.

## 🚀 Inicio Rápido

### Requisitos
- Docker y Docker Compose
- Redis ejecutándose en VM separada
- VM con 8GB RAM y 4 CPU

### Instalación

```bash
# 1. Clonar repositorio
git clone <repository-url>
cd gps-receiver-service

# 2. Configurar Redis externo
cp .env.example .env
# Editar .env y cambiar REDIS_HOST por la IP de tu Redis

# 3. Iniciar servicio
./start.sh    # Linux
start.bat     # Windows
```

## 📡 API Endpoints

### Enviar Posición GPS
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
  "accuracy": 5,
  "metadata": {
    "driver_id": "driver_123",
    "fuel_level": 75,
    "temperature": 22
  }
}
```

### Enviar Múltiples Posiciones
```bash
POST /api/gps/batch
Content-Type: application/json

{
  "positions": [
    {
      "id": "device_001",
      "lat": 40.7128,
      "lng": -74.0060,
      "timestamp": "2024-01-01T12:00:00Z",
      "speed": 50
    },
    {
      "id": "device_002",
      "lat": 40.7589,
      "lng": -73.9851,
      "timestamp": "2024-01-01T12:00:05Z",
      "speed": 30
    }
  ]
}
```

### Obtener Última Posición
```bash
GET /api/gps/device/{deviceId}/last
```

### Obtener Múltiples Últimas Posiciones
```bash
POST /api/gps/devices/last-positions
Content-Type: application/json

{
  "deviceIds": ["device_001", "device_002"]
}
```

### Estado del Sistema
```bash
GET /api/gps/health      # Estado de salud
GET /api/gps/stats       # Estadísticas detalladas
GET /metrics             # Métricas Prometheus
```

## 🔧 Configuración

### Variables de Entorno Principales (.env)
```env
# Redis (OBLIGATORIO)
REDIS_HOST=192.168.1.100    # IP de tu VM Redis
REDIS_PORT=6379
REDIS_PASSWORD=tu_password

# Procesamiento
BATCH_INTERVAL=10000        # Procesar cada 10 segundos
BATCH_MAX_SIZE=100         # Máximo 100 posiciones por lote
QUEUE_CONCURRENCY=5        # 5 workers concurrentes

# Limpieza
MAX_HISTORY_ENTRIES=500000  # Máximo registros históricos
CLEANUP_ENABLED=true       # Limpieza automática

# Detección de duplicados
DUPLICATE_DETECTION=true
DUPLICATE_TIME_THRESHOLD=1000      # 1 segundo
DUPLICATE_COORDINATE_THRESHOLD=0.0001  # ~10 metros
```

## 📊 Metadatos Soportados

El servicio acepta metadatos personalizados en el campo `metadata`:

### Gestión de Flotas
```json
{
  "metadata": {
    "vehicle_type": "truck",
    "driver_id": "driver_123",
    "license_plate": "ABC-123",
    "fuel_level": 75,
    "engine_rpm": 1850,
    "cargo_weight": 15000,
    "route_id": "route_456",
    "next_stop": "warehouse_b"
  }
}
```

### Aplicaciones de Delivery
```json
{
  "metadata": {
    "courier_id": "courier_789",
    "order_ids": ["order_001", "order_002"],
    "delivery_status": "en_route",
    "packages_count": 5,
    "battery_level": 85
  }
}
```

### Maquinaria de Construcción
```json
{
  "metadata": {
    "asset_type": "excavator",
    "operator_id": "op_001",
    "project_id": "proj_456",
    "engine_hours": 2847,
    "fuel_level": 68,
    "work_site": "site_alpha"
  }
}
```

## 🛠️ Comandos Útiles

```bash
# Ver logs en tiempo real
docker-compose logs -f

# Reiniciar servicio
docker-compose restart

# Detener servicio
docker-compose down

# Ver estadísticas
curl http://localhost:3000/api/gps/stats | jq

# Forzar limpieza
curl -X POST http://localhost:3000/api/gps/cleanup

# Ver estado de salud
curl http://localhost:3000/health | jq
```

## 🏗️ Arquitectura

El servicio utiliza:
- **Almacenamiento Dual en Redis**:
  - `gps:history:global` - Historial completo para otros microservicios
  - `gps:last:{deviceId}` - Última posición de cada dispositivo
- **Procesamiento por Lotes**: Optimiza el rendimiento agrupando posiciones
- **Colas BullMQ**: Procesamiento asíncrono y confiable
- **Detección de Duplicados**: Evita datos redundantes

## 🔍 Troubleshooting

### Problemas Comunes

**Servicio no inicia:**
```bash
docker-compose logs
# Verificar configuración Redis en .env
```

**No conecta a Redis:**
```bash
# Verificar conectividad
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping
```

**Alto uso de memoria:**
```bash
# Verificar estadísticas
curl http://localhost:3000/api/gps/stats | jq '.data.performance'
# Ejecutar limpieza
curl -X POST http://localhost:3000/api/gps/cleanup
```

## 📈 Rendimiento

Para VM de 8GB RAM / 4 CPU:
- **Capacidad**: Hasta 50,000 posiciones GPS/minuto
- **Latencia**: < 50ms promedio
- **Almacenamiento**: Dual (historial + últimas posiciones)
- **Escalabilidad**: Horizontal (múltiples instancias)

---

**El servicio está listo para recibir millones de posiciones GPS de forma eficiente!** 🚀