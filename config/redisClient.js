// src/config/redisClient.js
const redis = require('redis');
require("dotenv").config({ silent: true });

// Initialize Redis client
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Log and handle errors
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

// Notify when ready
redisClient.on('ready', () => {
  // console.log('Redis client is ready and connected.');
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
    console.log('Redis Connected.');
  } catch (err) {
    console.error('Radis Connection Failed', err);
  }
})();

module.exports = redisClient;
