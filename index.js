const express = require("express");
const app = express();
const cors = require("cors");
const http = require("http");
const bodyParser = require("body-parser");
require("dotenv").config({ silent: true });
const { init: initSocket } = require("./socket"); 


// const redisClient = redis.createClient();

// // Proper Redis client initialization
// redisClient.on("error", (err) => {
//   console.error("Redis Client Error:", err);
// });

// redisClient.on("ready", () => {
//   console.log("Redis client is ready and connected.");
// });

// redisClient
//   .connect()
//   .then(() => {
//     // Optionally, you can log here if you want to confirm connection
//     // console.log('Redis client connected.');
//   })
//   .catch((err) => {
//     console.error("Failed to connect to Redis:", err);
//   });

const port = process.env.PORT | 3000;
const server = http.createServer(app);
app.use(
  cors({
    origin:
      process.env.MODE === "prod"
        ? [process.env.CLIENT, process.env.CLIENT1]
        : ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    allowedHeaders: "Content-Type,Authorization",
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

initSocket(server, {
  cors: {
    origin:
      process.env.MODE === "prod"
        ? [process.env.CLIENT, process.env.CLIENT1]
        : ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
  },
});
app.use(bodyParser.json());

// Routes
app.use("/api", require("./routes/spreedSheetRoutes"));
app.use("/api", require("./routes/isUsBasedRoutes"));
app.use("/api", require("./routes/instantlyAiRoutes"));

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
