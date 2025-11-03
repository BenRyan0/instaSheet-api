const redis = require("redis");
require("dotenv").config();
const env = require("../env");

async function clearRedisData() {
  const mode = env.REDIS_ENV || "local";
  let redisClient;

  try {
    if (mode === "cloud") {
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

    // Handle events
    redisClient.on("error", (err) => {
      console.error("Redis Client Error:", err);
    });

    await redisClient.connect();
    console.log(`Connected to Redis (${mode})`);

    // Flush all data
    await redisClient.flushAll();
    console.log("All Redis data cleared successfully!");

  } catch (err) {
    console.error("Failed to clear Redis data:", err);
  } finally {
    if (redisClient) {
      await redisClient.quit();
      console.log("Redis connection closed.");
    }
  }
}

// Run directly if executed from CLI
if (require.main === module) {
  clearRedisData();
}

module.exports = clearRedisData;
