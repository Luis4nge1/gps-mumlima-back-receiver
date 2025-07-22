# Multi-stage build para optimizar tamaño y seguridad
FROM node:18-alpine AS builder

# Instalar dependencias del sistema necesarias
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    curl

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm ci --only=production && \
    npm cache clean --force

# Etapa de runtime
FROM node:18-alpine AS runtime

# Instalar curl para health checks
RUN apk add --no-cache curl

WORKDIR /app

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copiar dependencias desde builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar código fuente
COPY --chown=nodejs:nodejs . .

# Crear directorio de logs con permisos correctos
RUN mkdir -p logs && \
    chown -R nodejs:nodejs logs && \
    chmod 755 logs

# Cambiar a usuario no-root
USER nodejs

# Exponer puertos
EXPOSE 3000 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Comando por defecto
CMD ["npm", "start"]

# Metadata
LABEL maintainer="luis4nge1" \
      version="1.0.0" \
      description="GPS Receiver Microservice" \
      org.opencontainers.image.source="https://github.com/your-org/gps-receiver-service" \
      org.opencontainers.image.documentation="https://github.com/your-org/gps-receiver-service/blob/main/README.md"