const { initGoogleClients } = require("../services/googleClient.js");
const { responseReturn } = require("../utils/response.js");

class cardController {
  getAllSheets = async (req, res) => {
    try {
      const { sheets } = await initGoogleClients();

      const spreadsheetId = req.params.spreadsheetId;
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      // Extract sheet names
      const sheetNames = response.data.sheets.map(
        (sheet) => sheet.properties.title
      );

      responseReturn(res, 200, { spreadsheetId, sheets: sheetNames });
    } catch (err) {
      console.error("Error fetching sheets:", err);
      responseReturn(res, 500, { error: "Failed to fetch sheets" });
    }
  };

  AddNewSheetAndColumns = async (req, res) => {
    try {
      const { spreadsheetId } = req.params;
      const { sheetName, columns } = req.body;

      const { sheets } = await initGoogleClients();

      if (!sheetName || !columns) {
        return res
          .status(400)
          .json({ error: "sheetName and columns are required" });
      }

      //  Step 1: Get existing sheet names
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const existingSheetNames = spreadsheet.data.sheets.map(
        (s) => s.properties.title
      );

      // Step 2: If sheet already exists, skip creation
      if (existingSheetNames.includes(sheetName)) {
        responseReturn(res, 400, {
          error: `Sheet "${sheetName}" already exists in spreadsheet`,
        });
      }

      // Step 3: Add a new sheet (tab)
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: { title: sheetName },
              },
            },
          ],
        },
      });

      // Step 4: Add column headers to the new sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "RAW",
        requestBody: {
          values: [columns], // first row = column headers
        },
      });

      res.json({
        message: "New sheet created and columns added successfully",
        sheetName,
        columns,
      });
    } catch (err) {
      console.error("Error adding sheet:", err.response?.data || err.message);
      res.status(500).json({
        error: "Failed to add sheet",
        details: err.response?.data?.error?.message || err.message,
      });
    }
  };

  AppendRow = async (req, res) => {
    try {
      const { sheets } = await initGoogleClients();
      const { spreadsheetId, sheetName, row } = req.body;

      if (!spreadsheetId || !sheetName || !row) {
        return res.status(400).json({
          error: "Missing required fields: spreadsheetId, sheetName, row",
        });
      }

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:Z`, // appends to next available row
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [row], // one row only
        },
      });

      res.json({
        message: "Row appended successfully",
        updates: response.data.updates,
      });
    } catch (error) {
      console.error(
        "Error appending row:",
        error.response?.data || error.message
      );
      res.status(500).json({
        error: "Failed to append row",
        details: error.response?.data?.error?.message || error.message,
      });
    }
  };
}

module.exports = new cardController();
