const redis = require("redis");
require("dotenv").config();

const env = process.env.REDIS_ENV || "local"; // 'local' or 'cloud'
let redisClient;

if (env === "cloud") {
  console.log("Connecting to Redis Cloud...");

  redisClient = redis.createClient({
    socket: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
    },
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
  });
} else {
  console.log("Connecting to local Redis...");

  redisClient = redis.createClient({
    url: env.REDIS_URL || "redis://localhost:6379",
  });
}

// Handle errors
redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

redisClient.on("ready", () => {
  console.log(`Redis client ready [${env}]`);
});

// Connect
(async () => {
  try {
    await redisClient.connect();
    console.log(`Connected to Redis (${env})`);
  } catch (err) {
    console.error("Redis Connection Failed:", err);
  }
})();

// Optional: Graceful shutdown
process.on("SIGINT", async () => {
  await redisClient.quit();
  console.log("Redis connection closed.");
  process.exit(0);
});

module.exports = redisClient;
