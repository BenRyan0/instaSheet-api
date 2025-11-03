// services/dedupService.js

const { colorize } = require("../utils/colorLogger");
const { initGoogleClients } = require("../services/googleClient");

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

function normalizeKey(email) {
  if (!email || typeof email !== "string") return null;
  return email.toLowerCase().trim();
}
async function isProcessed(emailKey, redisClient, redisKey) {
  if (!emailKey) return false;
  return await redisClient.sIsMember(redisKey, emailKey);
}
async function markProcessed(emailKey, redisClient, redisKey, processedSet) {
  if (!emailKey) return false;

  // Already in our local cache?
  if (processedSet.has(emailKey)) {
    return false;
  }

  // Add to Redis; sAdd returns 1 if added, 0 if it was already there
  const added = await redisClient.sAdd(redisKey, emailKey);

  if (added === 1) {
    console.log(
      colorize("[dedup]", "lightBlue"),
      "newly added to Redis: ",
      colorize(`${emailKey}`, "lightBlue"),
      colorize("𝓡𝓮𝓭𝓲𝓼", "red")
    );
    processedSet.add(emailKey);
    return true;
  } else {
    console.log(
      colorize("[dedup]", "lightBlue"),
      "already in Redis: ",
      colorize(`${emailKey}`, "lightBlue"),
      colorize("𝓡𝓮𝓭𝓲𝓼", "red")
    );
    // Keep in local set so subsequent checks skip it too
    processedSet.add(emailKey);
    return false;
  }
}


// Add this small helper delay function
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function filterNewLeads(leads, processed, sheetNameForPartnership, sheetName, spreadsheetId) {
  const newLeads = [];
  const errors = [];

  for (const lead of leads) {
    const key = lead.email?.toLowerCase().trim();
    if (!key) {
      newLeads.push(lead);
      continue;
    }

    // Step 1: Check in-memory deduplication
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
      // Step 2: Check in the main sheet
      const { exists: existsInMain } = await checkLeadEmailExists(key, sheetName, spreadsheetId);

      if (existsInMain) {
        console.log(
          colorize("[sheet-dup]", "lightYellow"),
          "email:",
          colorize(`${key}`, "lightCyan"),
          "already exists in sheet",
          colorize(`${sheetName}`, "green")
        );
        continue;
      }

      // 🕐 Add delay before checking the partnership sheet
      await delay(500); // 0.5 second delay (adjust to 1000ms if still hitting quota)

      // Step 3: Check in the partnership sheet (if not found in main)
      const { exists: existsInPartnership } = await checkLeadEmailExists(
        key,
        sheetNameForPartnership,
        spreadsheetId
      );

      if (existsInPartnership) {
        console.log(
          colorize("[sheet-dup-2]", "lightYellow"),
          "email:",
          colorize(`${key}`, "lightCyan"),
          "already exists in partnership sheet",
          colorize(`${sheetNameForPartnership}`, "green")
        );
        continue;
      }

      // Step 4: If not found anywhere, it's a new lead
      console.log(
        colorize("[ LEAD OK ]", "green"),
        "email=",
        colorize(`${key}`, "lightCyan"),
        "does NOT exist in either sheet",
        colorize(`${sheetName} / ${sheetNameForPartnership}`, "green")
      );

      newLeads.push(lead);
      processed.add(key); // add to dedup cache

      // Optional: small delay before next iteration to slow down further
      await delay(200);

    } catch (err) {
      console.error(
        colorize("[error]", "bgRed"),
        `Error checking email=${key}:`,
        err.message
      );
      errors.push({ email: key, message: err.message });
      continue; // skip lead but keep processing others
    }
  }

  return { newLeads, errors, errorOccurred: errors.length > 0 };
}


// async function filterNewLeads(leads, processed, sheetNameForPartnership, sheetName, spreadsheetId) {
//   const newLeads = [];
//   const errors = [];

//   for (const lead of leads) {
//     const key = lead.email?.toLowerCase().trim();
//     if (!key) {
//       newLeads.push(lead);
//       continue;
//     }

//     // Step 1: Check in-memory deduplication
//     if (processed.has(key)) {
//       console.log(
//         colorize("[dedup]", "lightBlue"),
//         `already processed email:`,
//         colorize(`${key}`, "lightBlue"),
//         colorize("𝓡𝓮𝓭𝓲𝓼", "red")
//       );
//       continue;
//     }

//     try {
//       // Step 2: Check in the main sheet
//       const { exists: existsInMain } = await checkLeadEmailExists(key, sheetName, spreadsheetId);

//       if (existsInMain) {
//         console.log(
//           colorize("[sheet-dup]", "lightYellow"),
//           "email:",
//           colorize(`${key}`, "lightCyan"),
//           "already exists in sheet",
//           colorize(`${sheetName}`, "green")
//         );
//         continue;
//       }

//       // Step 3: Check in the partnership sheet (if not found in main)
//       const { exists: existsInPartnership } = await checkLeadEmailExists(
//         key,
//         sheetNameForPartnership,
//         spreadsheetId
//       );

//       if (existsInPartnership) {
//         console.log(
//           colorize("[sheet-dup-2]", "lightYellow"),
//           "email:",
//           colorize(`${key}`, "lightCyan"),
//           "already exists in partnership sheet",
//           colorize(`${sheetNameForPartnership}`, "green")
//         );
//         continue;
//       }

//       // Step 4: If not found anywhere, it's a new lead
//       console.log(
//         colorize("[ LEAD OK ]", "green"),
//         "email=",
//         colorize(`${key}`, "lightCyan"),
//         "does NOT exist in either sheet",
//         colorize(`${sheetName} / ${sheetNameForPartnership}`, "green")
//       );

//       newLeads.push(lead);
//       processed.add(key); //add to dedup cache

//     } catch (err) {
//       console.error(
//         colorize("[error]", "bgRed"),
//         `Error checking email=${key}:`,
//         err.message
//       );
//       errors.push({ email: key, message: err.message });
//       continue; // skip lead but keep processing others
//     }
//   }

//   return { newLeads, errors, errorOccurred: errors.length > 0 };
// }


module.exports = {
  normalizeKey,
  isProcessed,
  markProcessed,
  filterNewLeads,
};
