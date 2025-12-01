// resetRedis.js
const redis = require("redis");
require("dotenv").config();
const env = require("../env"); // adjust path if needed

const mode = env.REDIS_ENV || "local";

let redisClient;

console.log(`Redis Reset Script Started (${mode})`);

if (mode === "cloud") {
redisClient = redis.createClient({
  socket: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  },
  username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
});

} else {
  redisClient = redis.createClient({
    url: env.REDIS_URL || "redis://localhost:6379",
  });
}

redisClient.on("error", (err) => {
  console.error("❌ Redis Error:", err);
});

(async () => {
  try {
    await redisClient.connect();
    console.log("✅ Connected to Redis");

    // FLUSH ALL KEYS
    await redisClient.flushDb();

    console.log("🔥 Redis database has been RESET (FLUSHED).");

    await redisClient.quit();
    process.exit(0);
  } catch (err) {
    console.error("❌ Failed to reset Redis:", err);
    process.exit(1);
  }
})();
