const env = require("../../env");
const { colorize } = require("../../utils/colorLogger");

const {
  normalizeRow,
} = require("../../services/instantly/lead/normalizeService");
const {
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
  identifyBusinessCountry,
} = require("../../services/instantly/lead/interestService");
const {
  encodeToSheet,
  incrementFetchedInterestedLead,
} = require("../../services/instantly/lead/encodeService");
const { extractBusinessDescription } = require("../emailParserService");
const { mapToSheetRow } = require("../../mappers/sheetRow");

async function processEmailRow({
  emailRow,
  sheetName,
  sheetNameForPartnership,
  additionalContext,
  setErrorOccurred,
  setErrorContext,
  addToTotalEncoded,
  addTotalToBeApproved,
  addTotalEnterestedLLM,
  autoAppend,
  descriptionExtraction,
  state
}) {
  console.log(colorize("Processing lead Email ...", "blue"));
  const spreadsheetId = env.SPREADSHEET_ID;

  try {
    const rowJson = await normalizeRow(emailRow);

    // ---------- Step 1: Address Present ----------
    const hasAddressInfo =
      rowJson.address !== "none" ||
      rowJson.city !== "none" ||
      rowJson.state !== "none" ||
      rowJson.zip !== "none" ||
      rowJson["company phone#"] !== "none";

    if (hasAddressInfo) {
      const usAddress = await isAddressUsBased({
        city: rowJson.city,
        state: rowJson.state,
        address: rowJson.address,
        zip: rowJson.zip,
        phone: rowJson["company phone#"],
        setErrorOccurred,
        setErrorContext,
      });

      if (!usAddress) return true;

      const { interested, type } = await isActuallyInterested(
        rowJson["email reply"],
        addTotalEnterestedLLM,
        false
      );

      if (interested) {
        state.addTotalEnterestedLLM(1)
        const sheetNameForOffer = sheetName;
        await incrementFetchedInterestedLead()
        
        // const sheetNameForPartnership = "Partner MCA";

        // Corrected logic: use the proper sheet based on the type
        const sheetNameToUse =
          type === "partnership" ? sheetNameForPartnership : sheetNameForOffer;

        console.log("-------- rowJson.details --------");
        console.log(rowJson.details);
        // Replace details (website) with business description if available
        if (rowJson.details && rowJson.details !== "none") {
          // Check if details looks like a valid URL
          const isValidUrl = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(
            rowJson.details.trim()
          );

          if (isValidUrl) {
            try {
              const descResult = await extractBusinessDescription({
                websiteUrl: rowJson.details,
                setErrorOccurred,
                setErrorContext,
                descriptionExtraction,
              });

              if (
                descResult &&
                typeof descResult === "string" &&
                descResult.trim()
              ) {
                rowJson.details = descResult;
              } else {
                rowJson.details = "none";
              }
            } catch (err) {
              console.warn(
                "Failed to extract business description:",
                err.message
              );
              if (setErrorContext) {
                setErrorContext(
                  `Description extraction failed for ${rowJson.details}: ${err.message}`
                );
              }
              rowJson.details = "none";
            }
          } else {
            // Skip extraction if details isn't a URL
            console.log(
              `Skipping description extraction — not a valid URL: ${rowJson.details}`
            );
          }
        }

        
        await encodeToSheet(
          spreadsheetId,
          (sheetName = sheetNameToUse),
          rowJson,
          additionalContext,
          addToTotalEncoded,
          setErrorOccurred,
          setErrorContext,
          addTotalToBeApproved,
          autoAppend,
          type
        );
      }

      return true;
    }

    // ---------- Step 2: Website Present ----------
    if (rowJson.details && rowJson.details !== "none") {
      if (additionalContext.Website && additionalContext.Website !== "none") {
        const usWebsite = await identifyBusinessCountry(
          additionalContext.Website
        );
        if (!usWebsite) return true;
      }

      const { interested, type } = await isActuallyInterested(
        rowJson["email reply"],
        addTotalEnterestedLLM,
        false
      );

      console.log("type");
      console.log(type);

      console.log("interested");
      console.log(interested);
      if (interested) {
        state.addTotalEnterestedLLM(1)
        const sheetNameForOffer = sheetName;
         await incrementFetchedInterestedLead()
        // const sheetNameForPartnership = "Partner MCA";

        // Corrected logic: use the proper sheet based on the type
        const sheetNameToUse =
          type === "partnership" ? sheetNameForPartnership : sheetNameForOffer;
        try {
          const descResult = await extractBusinessDescription({
            websiteUrl: rowJson.details,
            setErrorOccurred,
            setErrorContext,
            descriptionExtraction,
          });

          if (
            descResult &&
            typeof descResult === "string" &&
            descResult.trim()
          ) {
            rowJson.details = descResult;
          } else {
            rowJson.details = "none";
          }
        } catch (err) {
          console.warn("Failed to extract business description:", err.message);
          rowJson.details = "none";
        }

        await encodeToSheet(
          spreadsheetId,
          (sheetName = sheetNameToUse),
          rowJson,
          additionalContext,
          addToTotalEncoded,
          setErrorOccurred,
          setErrorContext,
          addTotalToBeApproved,
          autoAppend,
          type
        );
      }

      return true;
    }

    // ---------- Step 3: No Address or Website ----------
    return true;
  } catch (err) {
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(err.message);
    console.error("processEmailRow failed:", err);
    return true;
  }
}

async function processEmailWithRetry({
  lead,
  email,
  sheetName,
  sheetNameForPartnership,
  runContext,
  maxRetries = 3,
  autoAppend,
  descriptionExtraction,
  state
}) {
  let row;
  try {
    row = await mapToSheetRow({
      lead,
      email,
      setErrorOccurred: runContext.setErrorOccurred,
      setErrorContext: runContext.setErrorContext,
    });
  } catch (err) {
    console.warn("mapToSheetRow failed", err.message);
    return false;
  }

  // Skip processing if row is null, undefined, or empty
  if (!row || (typeof row === "object" && Object.keys(row).length === 0)) {
    return false;
  }

  let processed = false;
  for (let attempts = 1; attempts <= maxRetries; attempts++) {
    try {
      processed = await processEmailRow({
        emailRow: row,
        sheetName,
         sheetNameForPartnership,
        additionalContext: {
          ClientID: lead.id || "N/A",
          Category: lead.category || "Uncategorized",
          TimeStamp: email.timestamp_email || new Date().toISOString(),
          Website: lead.website || lead.payload.website  || "none",
        },
        addToTotalEncoded: runContext.addToTotalEncoded,
        addTotalToBeApproved: runContext.addTotalToBeApproved,
        setErrorOccurred: runContext.setErrorOccurred,
        setErrorContext: runContext.setErrorContext,
        autoAppend,
        descriptionExtraction,
        state
      });

      if (processed) break;
    } catch (err) {
      console.warn("processEmailRow error", err.message);
    }

    await new Promise((r) => setTimeout(r, 500 * attempts));
  }

  return processed;
}

module.exports = { processEmailRow, processEmailWithRetry };
