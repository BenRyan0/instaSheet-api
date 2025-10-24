const express = require("express");
const app = express();
const cors = require("cors");
const http = require("http");
const bodyParser = require("body-parser");
require("dotenv").config({ silent: true });
const { init: initSocket } = require("./socket"); 
const { diagnoseGoogleSheetAccess } = require("./services/instantly/lead/encodeService");
const { extractBusinessDescription, scrapeWebsite } = require("./services/emailParserService");

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
app.use("/api", require("./routes/authRoutes"));
app.use("/api", require("./routes/spreedSheetRoutes"));
app.use("/api", require("./routes/isUsBasedRoutes"));
app.use("/api", require("./routes/instantlyAiRoutes"));
app.use("/api", require("./routes/loggerRoutes"));

// (async () => {
//   // const spreadsheetId = "15ywPV21oF7KKXZUaDaRBH4rAfkyDeyACSA5ExlldTRw";
//   const spreadsheetId = "1wvV00d1TPEzRu58wgfwz4zwe7j4irSXN5ih0fn5oqJo";
//   const sheetName = "MCA Loan";

//   const result = await diagnoseGoogleSheetAccess(spreadsheetId, sheetName);
//   console.log(result);
// })();
// diagnoseGoogleSheetAccess


// (async () => {
//   const result = await extractBusinessDescription({
//     websiteUrl: "info@tgpfirm.com",
//     setErrorOccurred: (val) => console.log("Error?", val),
//     setErrorContext: (msg) => console.log("Error context:", msg),
//   });

//   console.log("Business Description:", result.description);
// })();

// (async () => {
//   const API_KEY = process.env.SCRAPINGROBOT_API_KEY; // store securely in .env
//   const TARGET_URL = "https://www.pbb.com.ph/";

//   const result = await scrapeWebsite(TARGET_URL, API_KEY, {
//     param1: "value1",
//     param2: "value2",
//   });

//   console.log(JSON.stringify(result, null, 2));
// })();

server.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
