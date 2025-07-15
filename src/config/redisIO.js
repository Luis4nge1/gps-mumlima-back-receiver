// src/config/redisIO.js
import Redis from 'ioredis';
import config from './config.js';

const redisIOClient = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null, // Necesario para BullMQ
  enableOfflineQueue: false
});

export default redisIOClient;
