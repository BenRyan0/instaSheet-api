const env = require("../../../env");
const { initGoogleClients } = require("../../../services/googleClient.js");
const readline = require("readline");
const con = require("../../../db/db.js");
const { responseReturn } = require("../../../utils/response.js");
const { postAfterEncoding } = require("../../CRM/perfexCrm");
const { colorize } = require("../../../utils/colorLogger.js");

async function getSheetMetadata(sheets, spreadsheetId, sheetName) {
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTabs = meta.data.sheets.map((s) => s.properties.title);
    const targetSheet = meta.data.sheets.find(
      (s) => s.properties.title === sheetName
    );
    return { meta, existingTabs, targetSheet };
  } catch (err) {
    console.warn(
      `[warning] Cannot access Google Sheet "${spreadsheetId}" or tab "${sheetName}": ${err.message}`
    );
    return null; // Mark as inaccessible
  }
}

async function ensureSheetAndHeaders(
  sheets,
  spreadsheetId,
  sheetName,
  rowJson,
  metaData
) {
  const { existingTabs, targetSheet } = metaData;

  if (!existingTabs.includes(sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    const headers = Object.keys(rowJson);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  const sheetId = (targetSheet || {}).properties?.sheetId;
  if (!sheetId) throw new Error(`Sheet "${sheetName}" not found`);

  // Ensure headers are correct
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  const allValues = resp.data.values || [];
  let headers = allValues[0] || [];
  const expectedHeaders = Object.keys(rowJson);

  if (!headers.length || headers.length !== expectedHeaders.length) {
    headers = expectedHeaders;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  return { sheetId, allValues, headers };
}

function checkForDuplicates(allValues, headers, rowJson, sheetName) {
  const leadIdx = headers.indexOf("lead email");
  const replyIdx = headers.indexOf("email reply");

  if (leadIdx === -1 || replyIdx === -1) {
    throw new Error(
      `"lead email" or "email reply" columns not found in sheet "${sheetName}"`
    );
  }

  const existingLeadEmails = new Set();
  const existingPairs = new Set();

  for (let i = 1; i < allValues.length; i++) {
    const row = allValues[i];
    const leadEmail = (row[leadIdx] || "").toLowerCase().trim();
    const emailReply = (row[replyIdx] || "").toLowerCase().trim();
    if (leadEmail) existingLeadEmails.add(leadEmail);
    existingPairs.add(`${leadEmail}|${emailReply}`);
  }

  const newLeadEmail = (rowJson["lead email"] || "").toLowerCase().trim();
  const newEmailReply = (rowJson["email reply"] || "").toLowerCase().trim();

  if (existingLeadEmails.has(newLeadEmail)) {
    console.log(
      colorize("[skip]", "lightGreen"),
      ` lead email "${newLeadEmail}" already exists in "${sheetName}"`
    );
    return { duplicate: true, reason: "duplicate-lead-email" };
  }

  const pairKey = `${newLeadEmail}|${newEmailReply}`;
  if (existingPairs.has(pairKey)) {
    console.log(
      colorize("[skip]", "lightGreen"),
      ` row for lead="${newLeadEmail}" & reply="${newEmailReply}" already exists`
    );
    return { duplicate: true, reason: "duplicate-lead-email" };
  }

  return { duplicate: false };
}

async function confirmAppendIfNeeded(
  autoAppend,
  rowJson,
  additionalContext,
  fallbackFn
) {
  if (autoAppend) {
    console.log(`[auto-append] Skipping confirmation`);
    return true;
  }

  console.log("TimeStamp:", additionalContext.TimeStamp);
  console.log("Row to append:", rowJson);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let fallbackTriggered = false;
  const confirm = await Promise.race([
    new Promise((resolve) => {
      rl.question("Proceed with appending this row? (y/n): ", (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    }),
    (async () => {
      await new Promise((r) => setTimeout(r, 10000));
      rl.close();
      console.log("\nNo response after 10 seconds — running fallback...");
      await fallbackFn();
      fallbackTriggered = true;
      return "fallback";
    })(),
  ]);

  if (fallbackTriggered) return false;
  if (confirm !== "y" && confirm !== "yes") {
    console.log("Skipped appending to sheet.");
    return false;
  }

  return true;
}

async function appendRowToSheet(
  sheets,
  spreadsheetId,
  sheetName,
  headers,
  rowJson
) {
  const rowValues = headers.map((h) => rowJson[h] ?? "");
  return await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowValues] },
  });
}

async function encodeToSheet(
  spreadsheetId,
  sheetName,
  rowJson,
  additionalContext,
  addToTotalEncoded,
  setErrorOccurred,
  setErrorContext,
  addTotalToBeApproved,
  autoAppend
) {
  const { sheets } = await initGoogleClients();
console.log("sheetName")
console.log(sheetName)
  // STEP 1: Access sheet or fallback
  const metaData = await getSheetMetadata(sheets, spreadsheetId, sheetName);
  if (!metaData) {
    console.log(`[fallback] Proceeding directly to database encoding...`);
    await appendToLeadDatabase({
      rowJson,
      additionalContext,
      setErrorOccurred,
      setErrorContext,
      addTotalToBeApproved,
      spreadsheetId,
      sheetName,
    });
    return { success: false, reason: "sheet-inaccessible-fallback" };
  }

  // STEP 2: Ensure sheet & headers
  const { sheetId, allValues, headers } = await ensureSheetAndHeaders(
    sheets,
    spreadsheetId,
    sheetName,
    rowJson,
    metaData
  );

  // STEP 3: Deduplication
  const dupCheck = checkForDuplicates(allValues, headers, rowJson, sheetName);
  if (dupCheck.duplicate) return { success: false, reason: dupCheck.reason };

  // STEP 4: Confirmation or auto-append
  const proceed = await confirmAppendIfNeeded(
    autoAppend,
    rowJson,
    additionalContext,
    async () => {
      await appendToLeadDatabase({
        rowJson,
        additionalContext,
        setErrorOccurred,
        setErrorContext,
        addTotalToBeApproved,
        spreadsheetId,
        sheetName,
      });
    }
  );

  if (!proceed) return false;

  // STEP 5: Append row
  const appendResp = await appendRowToSheet(
    sheets,
    spreadsheetId,
    sheetName,
    headers,
    rowJson
  );
  console.log(`Appended row to "${sheetName}"`);
  await incrementApprovedEncodingLead();

  if (typeof addToTotalEncoded === "function") addToTotalEncoded(1);

  // STEP 6: Post-processing
  const nextRow = allValues.length + 1;
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=A${nextRow}`;

  await postAfterEncoding({
    rowJson,
    sheetUrl,
    additionalContext,
    setErrorOccurred,
    setErrorContext,
  });

  return appendResp.data ? true : false;
}

async function diagnoseGoogleSheetAccess(spreadsheetId, sheetName) {
  try {
    const { sheets } = await initGoogleClients();

    // 1Check if credentials are valid
    try {
      await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "spreadsheetId,sheets.properties.title",
      });
    } catch (authErr) {
      if (authErr.code === 403 || authErr.code === 401) {
        return {
          status: "error",
          reason: "service-account-unauthorized",
          details:
            "The service account credentials are invalid or lack access to the spreadsheet.",
        };
      } else if (authErr.code === 404) {
        return {
          status: "error",
          reason: "spreadsheet-not-found",
          details: "The spreadsheet ID may be incorrect or deleted.",
        };
      } else if (authErr.message?.includes("violates our Terms")) {
        return {
          status: "error",
          reason: "sheet-flagged-by-google",
          details:
            "The sheet was restricted by Google for policy violations. You must request a review in Google Drive.",
        };
      } else {
        throw authErr;
      }
    }

    //  Get sheet metadata again (if we reach here, credentials are fine)
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    const sheetTitles = meta.data.sheets.map((s) => s.properties.title);

    // Check if the sheet/tab exists
    if (sheetName && !sheetTitles.includes(sheetName)) {
      return {
        status: "warning",
        reason: "sheet-tab-missing",
        details: `Sheet tab "${sheetName}" not found in spreadsheet. Available sheets: ${sheetTitles.join(
          ", "
        )}`,
      };
    }

    // 4Try to read data from the first row
    const testRange = sheetName ? `${sheetName}!A1:A1` : "A1:A1";
    try {
      await sheets.spreadsheets.values.get({ spreadsheetId, range: testRange });
    } catch (readErr) {
      if (readErr.code === 403) {
        return {
          status: "error",
          reason: "sheet-read-permission-denied",
          details:
            "The service account does not have permission to read data from this sheet.",
        };
      } else {
        throw readErr;
      }
    }

    // All checks passed
    return {
      status: "ok",
      reason: "sheet-accessible",
      details: `Service account can access and read from sheet${
        sheetName ? ` "${sheetName}"` : ""
      }.`,
    };
  } catch (err) {
    return {
      status: "error",
      reason: "unexpected-error",
      details: err.message,
    };
  }
}

// Called when no user response within 30 seconds
async function appendToLeadDatabase({
  rowJson,
  setErrorOccurred,
  setErrorContext,
  additionalContext = {},
  addTotalToBeApproved,
  spreadsheetId,
  sheetName,
}) {
  // Validate required input
  if (!rowJson) {
    const error = new Error("Missing rowJson input.");
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext)
      setErrorContext(`appendToLeadDatabase: ${error.message}`);
    console.error(error.message);
    throw error;
  }

  const leadEmail = rowJson["lead email"]?.trim() || null;
  const emailReply = rowJson["email reply"]?.trim() || null;

  try {
    // --- Step 1: Check for duplicates ---
    const checkQuery = `
      SELECT id FROM toBeEncodedLeads
      WHERE lead_email = $1 OR email_reply = $2
      LIMIT 1;
    `;
    const checkResult = await con.query(checkQuery, [leadEmail, emailReply]);

    if (checkResult.rows.length > 0) {
      console.log(
        `Skipped insertion: Lead already exists (ID: ${checkResult.rows[0].id}).`
      );
      return null; // Indicate skip
    }

    // --- Step 2: Proceed with insertion ---
    const query = `
      INSERT INTO toBeEncodedLeads (
        column_1, for_scheduling, sales_person, sales_person_email, company,
        company_phone, phone_from_email, lead_first_name, lead_last_name,
        lead_email, column_2, email_reply, phone_1, phone_number, phone_2,
        address, city, state, zip, details, email_signature, linkedin_link,
        second_contact_person_linked, status_after_call,
        number_of_calls_spoken_with_leads, dropdown, clientid, tags, sheet_name, sheet_id, reply_timestamp, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, NOW(), NOW()
      )
      RETURNING id;
    `;

    const values = [
      rowJson["Column 1"]?.trim() || null,
      rowJson["For scheduling"]?.trim() || null,
      rowJson["sales person"]?.trim() || null,
      rowJson["sales person email"]?.trim() || null,
      rowJson["company"]?.trim() || null,
      rowJson["company phone#"]?.trim() || null,
      rowJson["phone#from email"]?.trim() || null,
      rowJson["lead first name"]?.trim() || null,
      rowJson["lead last name"]?.trim() || null,
      leadEmail,
      rowJson["Column 2"]?.trim() || null,
      emailReply,
      rowJson["phone 1"]?.trim() || null,
      rowJson["#"]?.trim() || null,
      rowJson["phone2"]?.trim() || null,
      rowJson["address"]?.trim() || null,
      rowJson["city"]?.trim() || null,
      rowJson["state"]?.trim() || null,
      rowJson["zip"]?.trim() || null,
      rowJson["details"]?.trim() || null,
      rowJson["Email Signature"]?.trim() || null,
      rowJson["linkedin link"]?.trim() || null,
      rowJson["2nd contact person linked"]?.trim() || null,
      rowJson["status after the call"]?.trim() || null,
      rowJson["number of calls spoken with the leads "]?.trim() || null,
      rowJson["@dropdown"]?.trim() || null,
      additionalContext.ClientID ?? null,
      additionalContext.Category ?? null,
      sheetName,
      spreadsheetId,
      additionalContext.TimeStamp ?? null,
    ];

    const result = await con.query(query, values);
    const insertedId = result.rows[0]?.id;
    console.log(`Lead inserted successfully with ID: ${insertedId}`);

    addTotalToBeApproved(1);

    await incrementFetchedInterestedLead();

    return insertedId;
  } catch (error) {
    console.error("Error inserting lead:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext)
      setErrorContext(`AppendToLeadDatabase: ${error.message}`);
    throw error;
  }
}

async function encodeLeadFromRequest({
  spreadsheetId,
  sheetName,
  leadData, // from req.body.lead
  setErrorOccurred,
  setErrorContext,
}) {
  try {
    const { sheets } = await initGoogleClients();
    console.log(`Spreadsheet Id: ${spreadsheetId}`);
    console.log(`Spreadsheet Name: ${sheetName}`);
    console.log(`Lead Data:`);
    console.log(leadData);

    // 1️  Ensure tab exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTabs = meta.data.sheets.map((s) => s.properties.title);
    let targetSheet = meta.data.sheets.find(
      (s) => s.properties.title === sheetName
    );

    if (!existingTabs.includes(sheetName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
      console.log(`Created new sheet tab: ${sheetName}`);

      // Re-fetch the sheet metadata to get the new sheetId
      const newMeta = await sheets.spreadsheets.get({ spreadsheetId });
      targetSheet = newMeta.data.sheets.find(
        (s) => s.properties.title === sheetName
      );
    }

    const sheetId = targetSheet.properties.sheetId;

    // 2️  Construct the row data
    const rowJson = {
      "Column 1": env.AGENT_NAME || "instaSheet agent x1",
      "For scheduling": leadData.for_scheduling || "none",
      "sales person": leadData.sales_person || "none",
      "sales person email": leadData.sales_person_email || "none",
      company: leadData.company || "none",
      "company phone#": leadData.company_phone || "none",
      "phone#from email": leadData.phone_from_email || "none",
      "lead first name": leadData.lead_first_name || "none",
      "lead last name": leadData.lead_last_name || "none",
      "lead email": leadData.lead_email || "none",
      "Column 2": leadData.lead_email || "none",
      "email reply": leadData.email_reply || "none",
      "phone 1": leadData.phone_1 || "none",
      "#": leadData.phone_number || leadData.phone_1 || "none",
      phone2: leadData.phone_2 || "none",
      address: leadData.address || "none",
      city: leadData.city || "none",
      state: leadData.state || "none",
      zip: leadData.zip || "none",
      details: leadData.details || "none",
      // "Email Signature": leadData.email_signature || "none",
      "Email Signature": "none",
      // "Email Signature": extracted.signature || emailSignature || "none",
      "linkedin link": "none",
      "status after the call": "none",
    };

    // 3️ Get existing rows
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: sheetName,
    });

    const allValues = resp.data.values || [];
    let headers = allValues[0] || [];
    const expectedHeaders = Object.keys(rowJson);

    // If headers missing or mismatched, reset headers
    if (!headers.length || headers.length !== expectedHeaders.length) {
      headers = expectedHeaders;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
      console.log("Added or corrected headers in sheet.");
    }

    // 4️ Deduplication logic
    const leadIdx = headers.indexOf("lead email");
    const replyIdx = headers.indexOf("email reply");

    if (leadIdx === -1 || replyIdx === -1) {
      throw new Error(
        `"lead email" or "email reply" columns not found in sheet "${sheetName}"`
      );
    }

    const existingLeadEmails = new Set();
    const existingPairs = new Set();

    for (let i = 1; i < allValues.length; i++) {
      const row = allValues[i];
      const leadEmail = (row[leadIdx] || "").toLowerCase().trim();
      const emailReply = (row[replyIdx] || "").toLowerCase().trim();
      if (leadEmail) existingLeadEmails.add(leadEmail);
      existingPairs.add(`${leadEmail}|${emailReply}`);
    }

    const newLeadEmail = (rowJson["lead email"] || "").toLowerCase().trim();
    const newEmailReply = (rowJson["email reply"] || "").toLowerCase().trim();

    if (existingLeadEmails.has(newLeadEmail)) {
      console.log(
        colorize("[skip]", "lightGreen"),
        ` lead email "${newLeadEmail}" already exists in "${sheetName}"`
      );
      return { success: false, reason: "duplicate-lead-email" };
    }

    const pairKey = `${newLeadEmail}|${newEmailReply}`;
    if (existingPairs.has(pairKey)) {
      console.log(
        colorize("[skip]", "lightGreen"),
        ` row for lead="${newLeadEmail}" & reply="${newEmailReply}" already exists`
      );
      return { success: false, reason: "duplicate-lead+reply" };
    }

    // 5️ Append row to Google Sheet
    const rowValues = headers.map((h) => rowJson[h] ?? "");
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });

    console.log("Lead successfully appended to Google Sheet.");

    // 6️ Generate sheet URL
    const nextRow = allValues.length + 1; // row number just appended
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=A${nextRow}`;
    console.log(`Generated sheet URL: ${sheetUrl}`);

    // 7️ Update DB
    if (leadData.id) {
      await con.query(
        `UPDATE toBeEncodedLeads SET isDone = true WHERE id = $1`,
        [leadData.id]
      );
      console.log(`Lead ID ${leadData.id} marked as done.`);
    }

    const additionalContext = {
      ClientID: leadData.clientid,
      Category: leadData.tags,
    };

    await postAfterEncoding({
      rowJson,
      sheetUrl,
      additionalContext,
      setErrorOccurred,
      setErrorContext,
    });

    // 8️ Post-processing

    await incrementApprovedEncodingLead();

    // Return both success and sheetUrl
    return { success: true, sheetUrl };
  } catch (error) {
    console.error("Error encoding lead:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext)
      setErrorContext(`encodeLeadFromRequest: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function incrementApprovedEncodingLead() {
  try {
    const approvalDate = ((d => `${d[2]}-${d[0].padStart(2,"0")}-${d[1].padStart(2,"0")}`)(new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila"}).split(",")[0].split("/")));
    // const approvalDate = new Date(createdAt).toISOString().split("T")[0];

    // Upsert logic: insert if not exists, else increment count
    await con.query(
      `
      INSERT INTO approved_encoding_lead (approval_date, approved_count)
      VALUES ($1, 1)
      ON CONFLICT (approval_date)
      DO UPDATE SET approved_count = approved_encoding_lead.approved_count + 1
      `,
      [approvalDate]
    );

    console.log(`Approved count updated for ${approvalDate}`);
  } catch (err) {
    console.error("Error updating approved_encoding_lead:", err.message);
  }
}

async function incrementFetchedInterestedLead() {
  try {
    const date_fetched = ((d => `${d[2]}-${d[0].padStart(2,"0")}-${d[1].padStart(2,"0")}`)(new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila"}).split(",")[0].split("/")));

    // Upsert logic: insert if not exists, else increment count
    await con.query(
      `
      INSERT INTO fetched_interested_lead (date_fetched, fetched_count)
      VALUES ($1, 1)
      ON CONFLICT (date_fetched)
      DO UPDATE SET fetched_count = fetched_interested_lead.fetched_count + 1
      `,
      [date_fetched]
    );

    console.log(`Fetched interested lead count updated for ${date_fetched}`);
  } catch (err) {
    console.error("Error updating fetched_interested_lead:", err.message);
  }
}
async function incrementTotalFetchedLeads(count) {
  if (typeof count !== "number" || count <= 0) {
    console.warn("Invalid count value:", count);
    return;
  }

  const date_fetched =((d => `${d[2]}-${d[0].padStart(2,"0")}-${d[1].padStart(2,"0")}`)(new Date().toLocaleString("en-PH",{timeZone:"Asia/Manila"}).split(",")[0].split("/")));

  try {
    const result = await con.query(
      `
      INSERT INTO fetched_leads (date_fetched, fetched_count)
      VALUES ($1, $2)
      ON CONFLICT (date_fetched)
      DO UPDATE SET fetched_count = fetched_leads.fetched_count + EXCLUDED.fetched_count
      RETURNING fetched_count;
      `,
      [date_fetched, count]
    );

    console.log(
      `Updated fetched_leads for ${date_fetched}: total = ${result.rows[0].fetched_count}`
    );
    return result.rows[0].fetched_count;
  } catch (err) {
    console.error("Error updating Total Fetched lead:", err.message);
  }
}

async function incrementClassifiedInterestReplies(type) {
  try {
    if (!["offers", "sba", "partnership"].includes(type)) {
      throw new Error(`Invalid type: ${type}`);
    }

    // Get current date in YYYY-MM-DD (Asia/Manila)
    const date_fetched = ((d =>
      `${d[2]}-${d[0].padStart(2, "0")}-${d[1].padStart(2, "0")}`)(
      new Date()
        .toLocaleString("en-PH", { timeZone: "Asia/Manila" })
        .split(",")[0]
        .split("/")
    ));

    // UPSERT logic — insert new or increment existing
    await con.query(
      `
      INSERT INTO classified_interest_replies (type, date_fetched, fetched_count)
      VALUES ($1, $2, 1)
      ON CONFLICT (type, date_fetched)
      DO UPDATE SET fetched_count = classified_interest_replies.fetched_count + 1
      `,
      [type, date_fetched]
    );

    console.log(`✅ Updated count for '${type}' on ${date_fetched}`);
  } catch (err) {
    console.error("❌ Error updating classified_interest_replies:", err.message);
  }
}


markToBeApprovedLead = async (req, res) => {
  const { id } = req.body;
  try {
    const query = `
      UPDATE tobeencodedleads
      SET isdone = true
      SET is_denied = true
      WHERE id = $1
      RETURNING *;
    `;

    const result = await con.query(query, [id]);

    if (result.rowCount === 0) {
      console.warn(`No record found with id=${id}`);
      return null;
    }

    console.log(
      `Successfully updated tobeencodedleads id=${id} (isdone = true)`
    );
    return responseReturn(res, 200, { message: "Denied Successfully" });
    // return result.rows[0];
  } catch (err) {
    return responseReturn(res, 500, {
      error: "Something Went Wrong, please try again",
    });
  }
};

module.exports = {
  encodeToSheet,
  encodeLeadFromRequest,
  markToBeApprovedLead,
  diagnoseGoogleSheetAccess,
  incrementFetchedInterestedLead,
  incrementTotalFetchedLeads,
  incrementClassifiedInterestReplies
};
