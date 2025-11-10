// services/dedupService.js

const { colorize } = require("../utils/colorLogger");
const { initGoogleClients } = require("../services/googleClient");



function normalizeKey(email) {
  if (!email || typeof email !== "string") return null;
  return email.toLowerCase().trim();
}
async function isProcessed(emailKey, redisClient, redisKey) {
  if (!emailKey) return false;
  return await redisClient.sIsMember(redisKey, emailKey);
}
async function markProcessed(emailKey, redisClient, redisKey, processedSet) {
  console.log(`EMAIL KEY: ${emailKey}`);
  if (!emailKey) return false;

  try {
    // Skip if already in memory
    if (processedSet.has(emailKey)) {
      console.log("02 - Already processed (local)");
      return false;
    }

    // Always ensure Redis has it
    const added = await redisClient.sAdd(redisKey, emailKey);

    if (added === 0) {
      console.log("03 - Already exists in Redis:", emailKey);
      processedSet.add(emailKey);
      return false;
    }
    console.log("Added new email to Redis:", emailKey);
    processedSet.add(emailKey);

   
    return true;
  } catch (err) {
    console.error("Redis error:", err.message);
    return false;
  }
}








// Add this small helper delay function
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Small helper delay function
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function filterNewLeads(leads, processed, spreadsheetId, sheetNames = [],{ runCtx }) {
  const newLeads = [];
  const error = [];

  // Ensure backward compatibility (add your old names if not already in array)
  // You can initialize it like:
  // const sheetNames = ["MainSheet", "PartnershipSheet"];
  if (!Array.isArray(sheetNames) || sheetNames.length === 0) {
    console.warn(
      colorize("[warn]", "bgYellow"),
      "No sheet names provided — please supply at least one."
    );
    return { newLeads: leads, error, errorOccurred: false };
  }

  for (const lead of leads) {
    const key = lead.email?.toLowerCase().trim();
    if (!key) {
      newLeads.push(lead);
      continue;
    }

    // Step 1: In-memory deduplication
    if (processed.has(key)) {
      console.log(
        colorize("[dedup]", "lightBlue"),
        `already processed email:`,
        colorize(`${key}`, "lightBlue"),
        colorize("𝓡𝓮𝓭𝓲𝓼", "red")
      );
      continue;
    }

    try {
      let existsAnywhere = false;

      // Step 2: Loop through all sheets in sheetNames[]
      for (let i = 0; i < sheetNames.length; i++) {
        const sheetToCheck = sheetNames[i];

        const { exists } = await checkLeadEmailExists(key, sheetToCheck, spreadsheetId);

        if (exists) {
          console.log(
            colorize("[sheet-dup]", "lightYellow"),
            "email:",
            colorize(`${key}`, "lightCyan"),
            "already exists in sheet",
            colorize(`${sheetToCheck}`, "green")
          );
          processed.add(key);
          existsAnywhere = true;
          break;
        }

        // Delay before checking next sheet (avoid rate-limit)
        if (i < sheetNames.length - 1) {
          await delay(500);
        }
      }

      if (existsAnywhere) continue;

      // Step 3: New lead — not found in any sheet
      console.log(
        colorize("[ LEAD OK ]", "green"),
        "email=",
        colorize(`${key}`, "lightCyan"),
        "does NOT exist in any of these sheets:",
        colorize(sheetNames.join(", "), "green")
      );
      runCtx.addTotalUnProcessedLeads(1)
      newLeads.push(lead);
      // processed.add(key);

      // Optional delay before next lead
      await delay(200);
    } catch (err) {
      console.error(
        colorize("[error]", "bgRed"),
        `Error checking email=${key}:`,
        err.message
      );
      error.push({ email: key, message: err.message });
      continue;
    }
  }

  return { newLeads, error, errorOccurred: error.length > 0 };
}



async function checkLeadEmailExists(email, sheetName, spreadsheetId) {
  if (!email || !sheetName || !spreadsheetId) {
    console.error(
      colorize("[error]", "bgRed"),
      "Missing required parameters for email check."
    );
    return { exists: false };
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    console.warn(
      colorize("[warn]", "bgYellow"),
      `Invalid email format: "${email}"`
    );
    return { exists: false };
  }

  try {
    const { sheets } = await initGoogleClients();

    // Fetch all rows from the target sheet
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });

    const allValues = res.data.values || [];
    if (allValues.length <= 1) {
      // No data beyond headers
      return { exists: false, totalRows: 0 };
    }

    // Detect "lead email" column
    const headers = allValues[0].map((h) => h.toLowerCase().trim());
    const leadIdx = headers.indexOf("lead email");

    if (leadIdx === -1) {
      console.warn(
        colorize("[warn]", "bgYellow"),
        `Column "lead email" not found in sheet "${sheetName}". Will only check column 2.`
      );
    }

    // Always check column 2 (index 1)
    const col2Idx = 1;

    // Scan rows for a match in either "lead email" or column 2
    for (let i = 1; i < allValues.length; i++) {
      const row = allValues[i];

      const emailFromLeadCol =
        leadIdx !== -1 ? (row[leadIdx] || "").toLowerCase().trim() : "";
      const emailFromCol2 = (row[col2Idx] || "").toLowerCase().trim();

      // If found in either column → email already exists → return true
      if (
        emailFromLeadCol === normalizedEmail ||
        emailFromCol2 === normalizedEmail
      ) {
        return { exists: true, matchedRow: i + 1 };
      }
    }

    // No match found in either column
    return { exists: false, totalRows: allValues.length };
  } catch (err) {
    console.error(
      colorize("[error]", "bgRed"),
      `Failed to check email in "${sheetName}": ${err.message}`
    );
    return { exists: false, error: err.message };
  }
}

module.exports = {
  normalizeKey,
  isProcessed,
  markProcessed,
  filterNewLeads,
};
