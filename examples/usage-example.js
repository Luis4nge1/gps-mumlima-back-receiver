#!/usr/bin/env node

/**
 * Ejemplo de uso del GPS Processing Service
 * Demuestra cómo enviar datos GPS y consultar información
 */

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000/api/gps';

// Función helper para hacer requests
async function makeRequest(endpoint, options = {}) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${data.error || 'Unknown error'}`);
    }
    
    return data;
  } catch (error) {
    console.error(`Error in ${endpoint}:`, error.message);
    throw error;
  }
}

// 1. Enviar una posición GPS individual
async function sendSinglePosition() {
  console.log('\n=== Enviando posición GPS individual ===');
  
  const position = {
    id: 'device_001',
    lat: 40.7128,
    lng: -74.0060,
    timestamp: new Date().toISOString(),
    speed: 50,
    heading: 180,
    altitude: 100,
    accuracy: 5
  };
  
  const result = await makeRequest('/position', {
    method: 'POST',
    body: JSON.stringify(position)
  });
  
  console.log('Resultado:', result);
}

// 2. Enviar un lote de posiciones GPS
async function sendBatchPositions() {
  console.log('\n=== Enviando lote de posiciones GPS ===');
  
  const positions = [
    {
      id: 'device_002',
      lat: 40.7589,
      lng: -73.9851,
      timestamp: new Date(Date.now() - 5000).toISOString(),
      speed: 30,
      heading: 90
    },
    {
      id: 'device_003',
      lat: 40.7505,
      lng: -73.9934,
      timestamp: new Date(Date.now() - 3000).toISOString(),
      speed: 25,
      heading: 270
    },
    {
      id: 'device_002', // Actualización del mismo dispositivo
      lat: 40.7600,
      lng: -73.9850,
      timestamp: new Date().toISOString(),
      speed: 35,
      heading: 95
    }
  ];
  
  const result = await makeRequest('/batch', {
    method: 'POST',
    body: JSON.stringify({ positions })
  });
  
  console.log('Resultado del lote:', result);
}

// 3. Obtener la última posición de un dispositivo
async function getLastPosition(deviceId) {
  console.log(`\n=== Obteniendo última posición de ${deviceId} ===`);
  
  try {
    const result = await makeRequest(`/device/${deviceId}/last`);
    console.log('Última posición:', result.data);
  } catch (error) {
    if (error.message.includes('404')) {
      console.log('No se encontró posición para este dispositivo');
    } else {
      throw error;
    }
  }
}

// 4. Obtener múltiples últimas posiciones
async function getMultipleLastPositions() {
  console.log('\n=== Obteniendo múltiples últimas posiciones ===');
  
  const deviceIds = ['device_001', 'device_002', 'device_003', 'device_999'];
  
  const result = await makeRequest('/devices/last-positions', {
    method: 'POST',
    body: JSON.stringify({ deviceIds })
  });
  
  console.log('Múltiples posiciones:', result.data);
}

// 5. Obtener estadísticas del sistema
async function getSystemStats() {
  console.log('\n=== Estadísticas del sistema ===');
  
  const result = await makeRequest('/stats');
  console.log('Estadísticas:', JSON.stringify(result.data, null, 2));
}

// 6. Verificar salud del sistema
async function checkHealth() {
  console.log('\n=== Verificando salud del sistema ===');
  
  const result = await makeRequest('/health');
  console.log('Estado de salud:', result.data);
}

// 7. Obtener estadísticas de almacenamiento Redis
async function getStorageStats() {
  console.log('\n=== Obteniendo estadísticas de almacenamiento ===');
  
  const result = await makeRequest('/stats');
  const storageStats = result.data.storage;
  
  console.log('Estadísticas de Redis:', {
    globalHistoryRecords: storageStats.globalHistory.totalRecords,
    devicesWithLastPosition: storageStats.lastPositions.deviceCount,
    utilizationPercent: storageStats.globalHistory.utilizationPercent
  });
  
  return storageStats;
}

// 9. Forzar procesamiento de lotes
async function forceBatchProcessing() {
  console.log('\n=== Forzando procesamiento de lotes ===');
  
  const result = await makeRequest('/force-batch-processing', {
    method: 'POST'
  });
  
  console.log('Resultado:', result);
}

// 10. Realizar limpieza del sistema
async function performCleanup() {
  console.log('\n=== Realizando limpieza del sistema ===');
  
  const result = await makeRequest('/cleanup', {
    method: 'POST'
  });
  
  console.log('Resultado:', result);
}

// Función principal que ejecuta todos los ejemplos
async function runExamples() {
  console.log('🚀 Iniciando ejemplos de uso del GPS Processing Service');
  
  try {
    // Verificar que el servicio esté funcionando
    await checkHealth();
    
    // Enviar datos GPS
    await sendSinglePosition();
    await sendBatchPositions();
    
    // Esperar un poco para que se procesen los lotes
    console.log('\n⏳ Esperando procesamiento de lotes...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Forzar procesamiento para asegurar que todo esté procesado
    await forceBatchProcessing();
    
    // Esperar un poco más
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Consultar datos
    await getLastPosition('device_001');
    await getLastPosition('device_002');
    await getLastPosition('device_999'); // Este no debería existir
    
    await getMultipleLastPositions();
    
    // Obtener estadísticas
    await getSystemStats();
    
    // Obtener estadísticas de almacenamiento
    await getStorageStats();
    
    // Limpieza final
    await performCleanup();
    
    console.log('\n✅ Todos los ejemplos completados exitosamente');
    
  } catch (error) {
    console.error('\n❌ Error ejecutando ejemplos:', error.message);
    process.exit(1);
  }
}

// Ejecutar ejemplos si este archivo se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples().catch(console.error);
}

export {
  sendSinglePosition,
  sendBatchPositions,
  getLastPosition,
  getMultipleLastPositions,
  getSystemStats,
  checkHealth,
  getStorageStats,
  forceBatchProcessing,
  performCleanup
};