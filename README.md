# 🛰️ GPS Receiver Service

Microservicio para recibir y almacenar datos GPS en Redis.

## 🚀 Uso con Docker

### Requisitos
- Docker y Docker Compose
- Redis ejecutándose en VM separada

### Configuración

1. **Configurar variables de entorno:**
```bash
cp .env.example .env
# Editar .env con la IP de tu Redis
```

2. **Iniciar servicio:**
```bash
docker-compose up -d
```

3. **Verificar:**
```bash
curl http://localhost:3000/health
```

## 📡 API

### Enviar posición GPS
```bash
POST /api/gps/position
{
  "id": "device_001",
  "lat": 40.7128,
  "lng": -74.0060,
  "timestamp": "2024-01-01T12:00:00Z",
  "speed": 50,
  "metadata": {
    "driver_id": "driver_123"
  }
}
```

### Obtener última posición
```bash
GET /api/gps/device/device_001/last
```

### Estado del sistema
```bash
GET /api/gps/health
GET /api/gps/stats
```

## ⚙️ Configuración (.env)

```env
# Redis (OBLIGATORIO)
REDIS_HOST=192.168.1.100
REDIS_PORT=6379
REDIS_PASSWORD=tu_password

# Procesamiento
BATCH_INTERVAL=10000
BATCH_MAX_SIZE=100
QUEUE_CONCURRENCY=5
```

## 🔧 Comandos Docker

```bash
# Iniciar
docker-compose up -d

# Ver logs
docker-compose logs -f

# Reiniciar
docker-compose restart

# Detener
docker-compose down
```