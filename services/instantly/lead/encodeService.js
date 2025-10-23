require("dotenv").config({ silent: true });
const axios = require("axios");
const { initGoogleClients } = require("../../../services/googleClient.js");
const readline = require("readline");
const con = require("../../../db/db.js");
const { responseReturn } = require("../../../utils/response.js");
const  {postAfterEncoding} = require("../../CRM/perfexCrm") 
const FormData = require("form-data");

async function encodeToSheet(
  spreadsheetId,
  sheetName,
  rowJson,
  additionalContext,
  addToTotalEncoded,
  setErrorOccurred,
  setErrorContext,
  addTotalToBeApproved
) {
  const { sheets } = await initGoogleClients();

  // Ensure tab exists and headers are in row 1
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = meta.data.sheets.map((s) => s.properties.title);
  const targetSheet = meta.data.sheets.find(
    (s) => s.properties.title === sheetName
  );

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

  // Target Shhet
  if (!targetSheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  const sheetId = targetSheet.properties.sheetId;

  // Read all existing rows
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

  // Deduplication setup
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
      `[skip] lead email "${newLeadEmail}" already exists in "${sheetName}"`
    );
    return { success: false, reason: "duplicate-lead-email" };
  }

  const pairKey = `${newLeadEmail}|${newEmailReply}`;
  if (existingPairs.has(pairKey)) {
    console.log(
      `[skip] row for lead="${newLeadEmail}" & reply="${newEmailReply}" already exists`
    );
    return { success: false, reason: "duplicate-lead-email" };
  }

  // Preview and confirm (with async timeout)
  console.log("TimeStamp: \n", additionalContext.TimeStamp);
  console.log("Row to append:\n", rowJson);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let confirm;
  let fallbackTriggered = false;
  confirm = await Promise.race([
    new Promise((resolve) => {
      rl.question("Proceed with appending this row? (y/n): ", (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    }),
    (async () => {
      await new Promise((r) => setTimeout(r, 10000));
      rl.close();
      console.log(
        "\n No response after 30 seconds — running fallback before proceeding..."
      );
      await appendToLeadDatabase({
        rowJson,
        additionalContext,
        setErrorOccurred,
        setErrorContext,
        addTotalToBeApproved,
        spreadsheetId,
        sheetName,
      }); // await async fallback before continuing
      fallbackTriggered = true;
      return "fallback";
    })(),
  ]);

  if (fallbackTriggered) {
    // Only append to DB, do not append to sheet or call postAfterEncoding
    return false;
  }

  if (confirm !== "y" && confirm !== "yes") {
    console.log(`Skipped appending to "${sheetName}"`);
    return false;
  }

  // Append the row
  const rowValues = headers.map((h) => rowJson[h] ?? "");
  const appendResp = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowValues] },
  });

  console.log(`Appended row to "${sheetName}"`);

  if (typeof addToTotalEncoded === "function") {
    addToTotalEncoded(1);
  }

  const nextRow = allValues.length + 1; // calculate before appending if needed
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=A${nextRow}`;

  // After successful append, run async post request before ending
  await postAfterEncoding({
    rowJson,
    sheetUrl,
    additionalContext,
    setErrorOccurred,
    setErrorContext,
  });

  return appendResp.data ? true : false;
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
    if (setErrorContext) setErrorContext(error.message);
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

    //  if (typeof addTotalToBeApproved === "function") {
    //     addTotalToBeApproved(1);
    //   }
    addTotalToBeApproved(1);

    await incrementFetchedInterestedLead();

    return insertedId;
  } catch (error) {
    console.error("Error inserting lead:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
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
      "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
      "For scheduling": leadData.for_scheduling || "",
      "sales person": leadData.sales_person || "",
      "sales person email": leadData.sales_person_email || "",
      company: leadData.company || "",
      "company phone#": leadData.company_phone || "none",
      "phone#from email": leadData.phone_from_email || "none",
      "lead first name": leadData.lead_first_name || "",
      "lead last name": leadData.lead_last_name || "",
      "lead email": leadData.lead_email || "",
      "Column 2": leadData.lead_email || "",
      "email reply": leadData.email_reply || "",
      "phone 1": leadData.phone_1 || "",
      "#": leadData.phone_number || leadData.phone_1 || "",
      phone2: leadData.phone_2 || "",
      address: leadData.address || "",
      city: leadData.city || "",
      state: leadData.state || "",
      zip: leadData.zip || "",
      details: leadData.details || "",
      "Email Signature": leadData.email_signature || "",
      "linkedin link": leadData.linkedin_link || "none",
      "2nd contact person linked":
        leadData.second_contact_person_linked || "none",
      "status after the call": leadData.status_after_call || "none",
      "number of calls spoken with the leads":
        leadData.number_of_calls_spoken_with_leads || "",
      "@dropdown": leadData.dropdown || "",
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
        `[skip] lead email "${newLeadEmail}" already exists in "${sheetName}"`
      );
      return { success: false, reason: "duplicate-lead-email" };
    }

    const pairKey = `${newLeadEmail}|${newEmailReply}`;
    if (existingPairs.has(pairKey)) {
      console.log(
        `[skip] row for lead="${newLeadEmail}" & reply="${newEmailReply}" already exists`
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

    // 8️ Post-processing
    await incrementApprovedEncodingLead({ createdAt: leadData.created_at });

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

    // Return both success and sheetUrl
    return { success: true, sheetUrl };
  } catch (error) {
    console.error("Error encoding lead:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
    return { success: false, error: error.message };
  }
}

async function incrementApprovedEncodingLead({ createdAt }) {
  try {
    // Extract only the date part (YYYY-MM-DD)
    const approvalDate = new Date(createdAt).toISOString().split("T")[0];

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
    // Use the current date (YYYY-MM-DD)
    const date_fetched = new Date().toISOString().split("T")[0];

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

async function incrementAppendedToCRMLeads() {
  try {
    // Use the current date (YYYY-MM-DD)
    const appended_date = new Date().toISOString().split("T")[0];

    // Upsert logic: insert if not exists, else increment count
    await con.query(
      `
      INSERT INTO appended_to_crm (appended_date, appended_count)
      VALUES ($1, 1)
      ON CONFLICT (appended_date)
      DO UPDATE SET appended_count = appended_to_crm.appended_count + 1
      `,
      [appended_date]
    );

    console.log(`Appended to CRM count updated for ${appended_date}`);
  } catch (err) {
    console.error("Error updating appended_to_crm:", err.message);
  }
}

markToBeApprovedLead = async (req, res) => {
  const { id } = req.body;
  try {
    const query = `
      UPDATE tobeencodedleads
      SET isdone = true
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
  markToBeApprovedLead
};
