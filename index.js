const express = require("express");
const app = express();
const cors = require("cors");
const http = require("http");
const bodyParser = require("body-parser");
const { init: initSocket } = require("./socket"); 



const env = require("./env");
// const clearRedisData = require("./config/clearRedis");
const port = env.PORT || 3000;
const server = http.createServer(app);


app.use(
  cors({
    origin:
      env.MODE === "prod"
        ? [env.CLIENT, env.CLIENT1]
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
      env.MODE === "prod"
        ? [env.CLIENT, env.CLIENT1]
        : ["http://localhost:5173", "http://localhost:5174"],
    credentials: true,
  },
});
app.use(bodyParser.json());

// Routes
app.use("/api", require("./routes/authRoutes"));
app.use("/api", require("./routes/spreadSheetRoutes"));
app.use("/api", require("./routes/isUsBasedRoutes"));
app.use("/api", require("./routes/instantlyAiRoutes"));
app.use("/api", require("./routes/loggerRoutes"));


app.get("/", (req, res) => {
  res.send("You Have Reached the endpoint of instaSheet");
});

app.get("/api/wakey-wakey", (req, res) => {
  res.status(200).json({ status: "ok", message: "Backend is awake!" });
});



server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
