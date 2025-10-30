const env = require("../../env");
const axios = require("axios");
const con = require("../../db/db.js");
const FormData = require("form-data");


async function postAfterEncoding(args) {
  const { rowJson, sheetUrl, additionalContext } = args;

  console.log("postAfterEncoding - ARGS");
  console.log(args);

  // Build tags array dynamically
  const tags = [];
  if (additionalContext?.Category) {
    tags.push(additionalContext.Category);
  }

  const reqBody = {
    source: "GOVA",
    status: "NEW",
    name: `test ${rowJson["lead first name"] || ""} ${
      rowJson["lead last name"] || ""
    }`.trim(),
    assigned: "unassigned",
    client_id: additionalContext.ClientID || "",
    tags,
    title: "",
    email: rowJson["lead email"] || "",
    website: rowJson.details || "",
    phonenumber: rowJson["company phone#"] || "",
    company: rowJson.company || "",
    address: rowJson.address || "",
    city: rowJson.city || "",
    zip: rowJson.zip || "",
    state: rowJson.state || "",
    country: "",
    default_language: "",
    description: rowJson["email reply"] || "",
    custom_contact_date: "",
    is_public: sheetUrl || "",
  };

  // Log all data that will be added to FormData
  console.log("---- FORM DATA CONTENTS ----");
  for (const [key, value] of Object.entries(reqBody)) {
    if (Array.isArray(value)) {
      value.forEach((v) => console.log(`${key}[]: ${v}`));
    } else {
      console.log(`${key}: ${value}`);
    }
  }
  console.log("-----------------------------");

  // Build FormData
  const form = new FormData();
  for (const [key, value] of Object.entries(reqBody)) {
    if (Array.isArray(value)) {
      value.forEach((v) => form.append(`${key}[]`, v));
    } else {
      form.append(key, value);
    }
  }

  // Merge FormData headers with AuthToken header
  const headers = {
    AuthToken: env.PERFEX_CRM_API_KEY,
    ...(typeof form.getHeaders === "function" ? form.getHeaders() : {}),
  };

  // Send POST request
  try {
    const response = await axios.post("https://govacrm.com/api/leads", form, {
      headers,
    });
    console.log("TO CRM POST REQ");
    console.log(response.data);

    await incrementAppendedToCRMLeads();
    
    return response.status === 200;
  } catch (err) {
    console.error("CRM post error:", err.response?.data || err.message);
    return false;
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



module.exports = {
  postAfterEncoding
};
