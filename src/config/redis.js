// src/config/redis.js
import { createClient } from 'redis';
import config from './config.js';
import logger from '../utils/logger.js';

const redisClient = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port
  },
  password: config.redis.password || undefined,
});

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('ready', () => {
  logger.info('Redis client ready');
});

redisClient.on('error', (err) => {
  logger.error('Redis client error', { error: err.message });
});

redisClient.on('end', () => {
  logger.info('Redis client connection closed');
});

redisClient.on('reconnecting', () => {
  logger.info('Redis client reconnecting');
});

await redisClient.connect(); // importante

export default redisClient;