// services/dedupService.js

const { colorize } = require("../utils/colorLogger")
const { initGoogleClients } = require("../services/googleClient");


async function checkLeadEmailExists(email, sheetName, spreadsheetId) {
  if (!email || !sheetName || !spreadsheetId) {
    console.error(colorize("[error]", "bgRed"), "Missing required parameters for email check.");
    return { exists: false };
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    console.warn(colorize("[warn]", "bgYellow"), `Invalid email format: "${email}"`);
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

      const emailFromLeadCol = leadIdx !== -1 ? (row[leadIdx] || "").toLowerCase().trim() : "";
      const emailFromCol2 = (row[col2Idx] || "").toLowerCase().trim();

      // If found in either column → email already exists → return true
      if (emailFromLeadCol === normalizedEmail || emailFromCol2 === normalizedEmail) {
        console.log(
          colorize("[duplicate]", "lightGreen"),
          `Email "${normalizedEmail}" already exists in "${sheetName}" (row ${i + 1}, column: ${
            emailFromLeadCol === normalizedEmail ? "lead email" : "column 2"
          }).`
        );
        return { exists: true, matchedRow: i + 1 };
      }
    }

    // No match found in either column
    console.log(
      colorize("[ok]", "bgGreen"),
      `Email "${normalizedEmail}" does NOT exist in "${sheetName}".`
    );
    return { exists: false, totalRows: allValues.length };
  } catch (err) {
    console.error(
      colorize("[error]", "bgRed"),
      `Failed to check email in "${sheetName}": ${err.message}`
    );
    return { exists: false, error: err.message };
  }
}



function normalizeKey(email) {
  if (!email || typeof email !== 'string') return null
  return email.toLowerCase().trim()
}
async function isProcessed(emailKey, redisClient, redisKey) {
  if (!emailKey) return false
  return await redisClient.sIsMember(redisKey, emailKey)
}
async function markProcessed(emailKey, redisClient, redisKey, processedSet) {
  console.log("emailKey")
  console.log(emailKey)
  if (!emailKey) return false

  // Already in our local cache?
  if (processedSet.has(emailKey)) {
    // console.log(colorize("[dedup]", "bgLightBlue"),`skipping, already in-memory: ${emailKey}`);
    return false
  }

  // Add to Redis; sAdd returns 1 if added, 0 if it was already there
  const added = await redisClient.sAdd(redisKey, emailKey)

  if (added === 1) {
    console.log(colorize("[dedup]", "bgLightBlue"),`newly added to Redis: ${emailKey}`);
    processedSet.add(emailKey)
    return true
  } else {
     console.log(colorize("[dedup]", "bgLightBlue"),` already in Redis: ${emailKey}`);
    // Keep in local set so subsequent checks skip it too
    processedSet.add(emailKey)
    return false
  }
}

async function filterNewLeads(leads, processed, sheetName, spreadsheetId) {
  const newLeads = [];
  let errorOccurred = false;

  for (const lead of leads) {
    const key = lead.email?.toLowerCase().trim();
    console.log("key:", key);

    // Skip leads with no email
    if (!key) {
      newLeads.push(lead);
      continue;
    }

    // Skip already processed emails
    if (processed.has(key)) {
      console.log(colorize("[dedup]", "bgLightBlue"), `already processed for email=${key}`);
      continue;
    }

    try {
      const { exists } = await checkLeadEmailExists(key, sheetName, spreadsheetId);

      if (exists) {
        // Email already in sheet — not an error, just skip
        console.log(
          colorize("[sheet-dup]", "bgYellow"),
          `email=${key} already exists in sheet ${sheetName}`
        );
        continue;
      } else {
        // Email not found — this is *OK*, it's a new lead
        console.log(
          colorize("[ok]", "bgGreen"),
          `email=${key} does NOT exist in sheet ${sheetName}`
        );
      }

    } catch (err) {
      // Only real exceptions are errors (e.g., API failure)
      console.error(colorize("[error]", "bgRed"), `Error checking email=${key}:`, err.message);
      errorOccurred = true;
      break; // stop the loop if a real error occurs
    }

    // Add only new (non-duplicate) leads
    newLeads.push(lead);
  }

  return { newLeads, error: errorOccurred };
}



module.exports = {
  normalizeKey,
  isProcessed,
  markProcessed,
  filterNewLeads
}
