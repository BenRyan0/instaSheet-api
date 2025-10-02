const express = require("express");
const app = express();
const cors = require("cors");
const http = require("http");
const bodyParser = require("body-parser");
require("dotenv").config({ silent: true });
const { init: initSocket } = require("./socket"); 

// postgre
const {Client} = require('pg')

const con = new Client({
  host: "localhost",
  user: "postgres",
  port: 5432,
  password : "root",
  database : "insta-sheet-db"
})


con.connect().then(()=> console.log("postgre connected"))
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
app.use("/api", require("./routes/loggerRoutes"));

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
