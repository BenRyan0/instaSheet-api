const { spawn } = require("child_process");
const { responseReturn } = require("../utils/response");

class isUsBased {
  checkIfUSBased = async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return responseReturn(res, 400, { error: "URL is required" });
      }

      const { spawn } = require("child_process");

      const result = await new Promise((resolve, reject) => {
        const py = spawn("python", ["isUsBased.py", url]);

        let output = "";
        py.stdout.on("data", (data) => {
          output += data.toString();
        });

        py.stderr.on("data", (data) => {
          console.error(`Python error: ${data}`);
        });

        py.on("close", (code) => {
          if (code !== 0) {
            return reject(new Error(`Python exited with code ${code}`));
          }
          resolve(output.trim());
        });
      });

      console.log("Raw response from Python file:", result);

      let parsed;
      try {
        parsed = JSON.parse(result);
      } catch (err) {
        console.error("Failed to parse JSON from Python:", err);
        return responseReturn(res, 500, {
          error: "Invalid JSON from Python script",
        });
      }

      const { isUs, confidenceRate, matches } = parsed;

      responseReturn(res, 200, { url, isUs, confidenceRate, matches });
    } catch (err) {
      console.error("Error checking US location:", err);
      responseReturn(res, 500, { error: "Failed to check US location" });
    }
  };
}

module.exports = new isUsBased();
