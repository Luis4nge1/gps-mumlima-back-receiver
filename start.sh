#!/bin/bash

echo "🚀 Iniciando GPS Receiver Service..."

# Verificar Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker no está instalado"
    exit 1
fi

# Crear directorio de logs
mkdir -p logs

# Verificar archivo .env
if [ ! -f .env ]; then
    echo "⚠️  Creando .env desde .env.example"
    cp .env.example .env
    echo "📝 Configura REDIS_HOST en .env con la IP de tu Redis"
    exit 1
fi

# Verificar Redis
REDIS_HOST=$(grep REDIS_HOST .env | cut -d '=' -f2)
if [ -z "$REDIS_HOST" ] || [ "$REDIS_HOST" = "localhost" ]; then
    echo "⚠️  Configura REDIS_HOST en .env"
    exit 1
fi

# Iniciar servicio
echo "🐳 Iniciando contenedor..."
docker-compose up -d

# Esperar y verificar
sleep 10
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Servicio iniciado correctamente"
    echo "📊 API: http://localhost:3000"
    echo "🔍 Health: http://localhost:3000/health"
    echo "📈 Stats: http://localhost:3000/api/gps/stats"
else
    echo "❌ Error al iniciar"
    docker-compose logs
fi