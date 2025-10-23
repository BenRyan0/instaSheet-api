require("dotenv").config({ silent: true });
const { colorize } = require("../../utils/colorLogger");
// const {
//   normalizeRow,
//   isAddressUsBased,
//   isWebsiteUsBased,
//   isActuallyInterested,
//   encodeToSheet,
// } = require("../leadServices");
const {
  normalizeRow,
} = require("../../services/instantly/lead/normalizeService");
const {
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested
} = require("../../services/instantly/lead/interestService");
const {
  encodeToSheet
} = require("../../services/instantly/lead/encodeService");
// const {
//   normalizeRow,
//   isAddressUsBased,
//   isWebsiteUsBased,
//   isActuallyInterested,
//   encodeToSheet,
// } = require("../leadServices");

async function processEmailRow({
    emailRow,
    sheetName,
    additionalContext,
    setErrorOccurred,
    setErrorContext,
    addToTotalEncoded,
    addTotalToBeApproved,
    addTotalEnterestedLLM
  }) {
    console.log(colorize("Processing lead Email ...", "blue"));
    console.log("additionalContext");
    console.log(additionalContext);
    const spreadsheetId = process.env.SPREADSHEET_ID;
    try {
      const rowJson = await normalizeRow(emailRow);
      // --- Step 1: Address present? ---
      if (
        rowJson.address ||
        rowJson.city ||
        rowJson.state ||
        rowJson.zip ||
        rowJson["company phone#"]
      ) {
        const usAddress = await isAddressUsBased({
          city: rowJson.city,
          state: rowJson.state,
          address: rowJson.address,
          zip: rowJson.zip,
          phone: rowJson["company phone#"],
          setErrorOccurred,
          setErrorContext,
        });
        if (!usAddress) return true; // Skip but still return true

        const interested = await isActuallyInterested(
          rowJson["email reply"],
          addTotalEnterestedLLM,
          false
        );
        if (interested) {
          await encodeToSheet(
            spreadsheetId,
            sheetName,
            rowJson,
            additionalContext,
            addToTotalEncoded,
            setErrorOccurred,
            setErrorContext,
            addTotalToBeApproved
          );
        }
        return true; // Continue flow regardless
      }
      // --- Step 2: Website present? ---
      if (rowJson.details) {
        const usWebsite = await isWebsiteUsBased(rowJson.details);
        if (!usWebsite) return true; // Skip but still return true

        const interested = await isActuallyInterested(
          rowJson["email reply"],
          addTotalEnterestedLLM,
          false
        );
        if (interested) {
          await encodeToSheet(
            spreadsheetId,
            sheetName,
            rowJson,
            additionalContext,
            addToTotalEncoded,
            setErrorOccurred,
            setErrorContext,
            addTotalToBeApproved
          );
        }
        return true; // Continue flow regardless
      }

      return true;
    } catch (err) {
      if (setErrorOccurred) setErrorOccurred(true);
      if (setErrorContext) setErrorContext(err.message);
      console.error("processEmailRow failed:", err.message);
      return true; // Ensure main flow continues even on error
    }
  }



module.exports = { processEmailRow };
