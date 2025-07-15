import zlib from 'zlib';
import { promisify } from 'util';
import logger from './logger.js';

// Promisify zlib methods
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Compress data using gzip
 * @param {Object} data - Data to compress
 * @returns {Promise<Buffer>} Compressed data
 */
export const compressData = async (data) => {
  try {
    const jsonString = JSON.stringify(data);
    const compressed = await gzip(jsonString);
    
    logger.debug('Data compressed', {
      originalSize: jsonString.length,
      compressedSize: compressed.length,
      compressionRatio: (compressed.length / jsonString.length * 100).toFixed(2) + '%'
    });
    
    return compressed;
  } catch (error) {
    logger.error('Error compressing data', {
      error: error.message,
      data: typeof data
    });
    throw error;
  }
};

/**
 * Decompress data using gzip
 * @param {Buffer} compressedData - Compressed data
 * @returns {Promise<Object>} Decompressed data
 */
export const decompressData = async (compressedData) => {
  try {
    const decompressed = await gunzip(compressedData);
    const jsonString = decompressed.toString();
    const data = JSON.parse(jsonString);
    
    logger.debug('Data decompressed', {
      compressedSize: compressedData.length,
      decompressedSize: jsonString.length
    });
    
    return data;
  } catch (error) {
    logger.error('Error decompressing data', {
      error: error.message,
      compressedDataLength: compressedData?.length
    });
    throw error;
  }
};