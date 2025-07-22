@echo off
echo 🚀 Iniciando GPS Receiver Service...

REM Verificar Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker no está instalado
    pause
    exit /b 1
)

REM Crear directorio de logs
if not exist logs mkdir logs

REM Verificar archivo .env
if not exist .env (
    echo ⚠️  Creando .env desde .env.example
    copy .env.example .env
    echo 📝 Configura REDIS_HOST en .env con la IP de tu Redis
    pause
    exit /b 1
)

REM Iniciar servicio
echo 🐳 Iniciando contenedor...
docker-compose up -d

REM Esperar y verificar
echo ⏳ Esperando...
timeout /t 10 /nobreak >nul

curl -f http://localhost:3000/health >nul 2>&1
if errorlevel 1 (
    echo ❌ Error al iniciar
    docker-compose logs
    pause
    exit /b 1
)

echo ✅ Servicio iniciado correctamente
echo 📊 API: http://localhost:3000
echo 🔍 Health: http://localhost:3000/health
echo 📈 Stats: http://localhost:3000/api/gps/stats
pause