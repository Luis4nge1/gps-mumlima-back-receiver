#!/usr/bin/env node

/**
 * Script de migración para transicionar del sistema anterior al nuevo sistema modular
 * Este script ayuda a migrar datos existentes y verificar la compatibilidad
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import Redis from 'redis';
import logger from '../src/utils/logger.js';
import config from '../src/config/config.js';

class MigrationScript {
  constructor() {
    this.redisClient = null;
    this.migrationStats = {
      startTime: new Date(),
      devicesProcessed: 0,
      recordsMigrated: 0,
      errors: 0
    };
  }

  async initialize() {
    try {
      // Conectar a Redis
      this.redisClient = Redis.createClient({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db
      });

      await this.redisClient.connect();
      logger.info('Connected to Redis for migration');

    } catch (error) {
      logger.error('Failed to initialize migration script', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Migra datos del formato anterior al nuevo formato
   */
  async migrateData() {
    console.log('\n🔄 Iniciando migración de datos...');

    try {
      // 1. Migrar historial individual a historial global
      await this.migrateHistoricalData();

      // 2. Verificar últimas posiciones
      await this.verifyLatestPositions();

      // 3. Limpiar datos antiguos (opcional)
      await this.cleanupOldData();

      console.log('\n✅ Migración completada exitosamente');
      this.printMigrationStats();

    } catch (error) {
      console.error('\n❌ Error durante la migración:', error.message);
      throw error;
    }
  }

  /**
   * Migra datos históricos del formato anterior al nuevo formato global
   */
  async migrateHistoricalData() {
    console.log('\n📊 Migrando datos históricos...');

    try {
      // Buscar todas las claves de historial individual
      const historicalKeys = await this.redisClient.keys('gps:history:*');
      const globalHistoryKey = 'gps:history:global';

      if (historicalKeys.length === 0) {
        console.log('No se encontraron datos históricos para migrar');
        return;
      }

      console.log(`Encontradas ${historicalKeys.length} claves de historial individual`);

      const pipeline = this.redisClient.pipeline();
      let totalRecords = 0;

      for (const key of historicalKeys) {
        // Extraer deviceId de la clave
        const deviceId = key.replace('gps:history:', '');
        
        // Obtener todos los registros de este dispositivo
        const records = await this.redisClient.lrange(key, 0, -1);
        
        if (records.length === 0) continue;

        console.log(`Migrando ${records.length} registros del dispositivo ${deviceId}`);

        // Convertir cada registro al nuevo formato
        const migratedRecords = records.map(record => {
          try {
            const parsed = JSON.parse(record);
            
            // Convertir al nuevo formato global
            const globalRecord = {
              deviceId: deviceId,
              lat: parsed.lat,
              lng: parsed.lng,
              timestamp: parsed.timestamp,
              receivedAt: parsed.receivedAt || parsed.timestamp,
              batchId: `migration_${Date.now()}`,
              metadata: parsed.metadata || {}
            };

            return JSON.stringify(globalRecord);

          } catch (error) {
            logger.error('Error parsing historical record', {
              deviceId,
              record: record.substring(0, 100),
              error: error.message
            });
            this.migrationStats.errors++;
            return null;
          }
        }).filter(record => record !== null);

        // Agregar al historial global
        if (migratedRecords.length > 0) {
          pipeline.rpush(globalHistoryKey, ...migratedRecords);
          totalRecords += migratedRecords.length;
        }

        this.migrationStats.devicesProcessed++;
      }

      // Ejecutar todas las operaciones
      await pipeline.exec();
      this.migrationStats.recordsMigrated = totalRecords;

      console.log(`✅ Migrados ${totalRecords} registros históricos de ${historicalKeys.length} dispositivos`);

    } catch (error) {
      logger.error('Error migrating historical data', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Verifica y actualiza el formato de las últimas posiciones
   */
  async verifyLatestPositions() {
    console.log('\n📍 Verificando últimas posiciones...');

    try {
      const lastPositionKeys = await this.redisClient.keys('gps:last:*');

      if (lastPositionKeys.length === 0) {
        console.log('No se encontraron últimas posiciones');
        return;
      }

      console.log(`Verificando ${lastPositionKeys.length} últimas posiciones`);

      let updatedPositions = 0;

      for (const key of lastPositionKeys) {
        const position = await this.redisClient.hgetall(key);

        if (!position || Object.keys(position).length === 0) {
          continue;
        }

        // Verificar si necesita actualización de formato
        let needsUpdate = false;
        const updates = {};

        // Asegurar que tenga updatedAt
        if (!position.updatedAt) {
          updates.updatedAt = new Date().toISOString();
          needsUpdate = true;
        }

        // Asegurar que tenga metadata como string JSON
        if (!position.metadata) {
          updates.metadata = '{}';
          needsUpdate = true;
        } else if (typeof position.metadata === 'object') {
          updates.metadata = JSON.stringify(position.metadata);
          needsUpdate = true;
        }

        // Aplicar actualizaciones si es necesario
        if (needsUpdate) {
          await this.redisClient.hset(key, updates);
          updatedPositions++;
        }
      }

      console.log(`✅ Actualizadas ${updatedPositions} últimas posiciones`);

    } catch (error) {
      logger.error('Error verifying latest positions', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Limpia datos del formato anterior (opcional)
   */
  async cleanupOldData() {
    console.log('\n🧹 Limpiando datos antiguos...');

    const shouldCleanup = process.argv.includes('--cleanup');

    if (!shouldCleanup) {
      console.log('Saltando limpieza (usar --cleanup para limpiar datos antiguos)');
      return;
    }

    try {
      // Eliminar claves de historial individual
      const historicalKeys = await this.redisClient.keys('gps:history:*');
      const globalHistoryKey = 'gps:history:global';
      
      // Filtrar para no eliminar la clave global
      const keysToDelete = historicalKeys.filter(key => key !== globalHistoryKey);

      if (keysToDelete.length > 0) {
        await this.redisClient.del(...keysToDelete);
        console.log(`🗑️ Eliminadas ${keysToDelete.length} claves de historial individual`);
      }

      // Limpiar otras claves obsoletas si existen
      const obsoletePatterns = [
        'gps:queue:*', // Colas del sistema anterior
        'gps:batch:*', // Lotes del sistema anterior
      ];

      for (const pattern of obsoletePatterns) {
        const keys = await this.redisClient.keys(pattern);
        if (keys.length > 0) {
          await this.redisClient.del(...keys);
          console.log(`🗑️ Eliminadas ${keys.length} claves obsoletas (${pattern})`);
        }
      }

    } catch (error) {
      logger.error('Error during cleanup', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Verifica la integridad de los datos migrados
   */
  async verifyMigration() {
    console.log('\n🔍 Verificando integridad de la migración...');

    try {
      // Verificar historial global
      const globalHistoryCount = await this.redisClient.llen('gps:history:global');
      console.log(`📊 Registros en historial global: ${globalHistoryCount}`);

      // Verificar últimas posiciones
      const lastPositionKeys = await this.redisClient.keys('gps:last:*');
      console.log(`📍 Dispositivos con última posición: ${lastPositionKeys.length}`);

      // Obtener muestra del historial global
      const sampleRecords = await this.redisClient.lrange('gps:history:global', -5, -1);
      console.log('\n📋 Muestra de registros migrados:');
      sampleRecords.forEach((record, index) => {
        try {
          const parsed = JSON.parse(record);
          console.log(`  ${index + 1}. Dispositivo: ${parsed.deviceId}, Lat: ${parsed.lat}, Lng: ${parsed.lng}`);
        } catch (error) {
          console.log(`  ${index + 1}. Error parsing record: ${record.substring(0, 50)}...`);
        }
      });

      console.log('\n✅ Verificación de integridad completada');

    } catch (error) {
      logger.error('Error verifying migration', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Imprime estadísticas de la migración
   */
  printMigrationStats() {
    const duration = Date.now() - this.migrationStats.startTime.getTime();
    
    console.log('\n📈 Estadísticas de migración:');
    console.log(`⏱️  Duración: ${Math.round(duration / 1000)}s`);
    console.log(`📱 Dispositivos procesados: ${this.migrationStats.devicesProcessed}`);
    console.log(`📊 Registros migrados: ${this.migrationStats.recordsMigrated}`);
    console.log(`❌ Errores: ${this.migrationStats.errors}`);
    
    if (this.migrationStats.recordsMigrated > 0) {
      const recordsPerSecond = Math.round(this.migrationStats.recordsMigrated / (duration / 1000));
      console.log(`🚀 Velocidad: ${recordsPerSecond} registros/segundo`);
    }
  }

  /**
   * Cierra las conexiones
   */
  async cleanup() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }
}

// Función principal
async function runMigration() {
  const migration = new MigrationScript();

  try {
    console.log('🚀 Iniciando migración al sistema modular GPS Processing Service');
    console.log('📋 Este script migrará datos del formato anterior al nuevo formato modular\n');

    await migration.initialize();
    await migration.migrateData();
    await migration.verifyMigration();

    console.log('\n🎉 Migración completada exitosamente!');
    console.log('💡 El sistema está listo para usar la nueva arquitectura modular');

  } catch (error) {
    console.error('\n💥 Error durante la migración:', error.message);
    process.exit(1);
  } finally {
    await migration.cleanup();
  }
}

// Ejecutar migración si este archivo se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration().catch(console.error);
}

export default MigrationScript;