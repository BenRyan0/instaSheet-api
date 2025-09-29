require("dotenv").config({ silent: true });
const { colorize } = require("../utils/colorLogger");
const { patterns } = require("../Filters/addressRegexConfig.json");
const { spawn } = require("child_process");
const { initGoogleClients } = require("../services/googleClient.js");

const regexes = {};
for (const [key, { pattern, flags }] of Object.entries(patterns)) {
  regexes[key] = new RegExp(pattern, flags);
}

async function normalizeRow(emailRow) {
  return {
    Agent: emailRow["Agent"] || "instaSheet agent",
    "For scheduling": emailRow["For scheduling"] || "",
    "sales person": emailRow["sales person"] || "",
    "sales person email": emailRow["sales person email"] || "",
    company: emailRow["company"] || "N/A",
    "company phone#":
      emailRow["company phone#"] ||
      emailRow["phone 1"] ||
      emailRow["phone2"] ||
      "",
    "phone#from email": emailRow["phone#from email"] || "",
    "lead first name": emailRow["lead first name"] || "",
    "lead last name": emailRow["lead last name"] || "",
    "lead email": emailRow["lead email"] || "",
    "Column 1": emailRow["Column 1"] || emailRow["lead email"] || "",
    "email reply": emailRow["email reply"] || "",
    "phone 1": emailRow["phone 1"] || "",
    phone2: emailRow.phone2 || "",
    address: emailRow.address || "",
    city: emailRow.city || "",
    state: emailRow.state || "",
    zip: emailRow.zip || "",
    details: emailRow.details || "",
    "Email Signature": emailRow["Email Signature"] || "",
    "linkedin link": "none",
    "2nd contact person linked": "none",
    "status after the call": "",
    "number of calls spoken with the leads ": "",
    "@dropdown": "",
    "number of calls spoken with the leads ": "",
  };
}

async function isUSByAI(addressText) {
  if (!addressText || addressText.trim() === "") return false;

  try {
    console.log("Classifying address with AI (Ollama)...");

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama3.2", // you can swap this with any local Ollama model
        messages: [
          {
            role: "system",
            content: `Return only "true" or "false".
              
  - Reply "true" if the input text clearly describes a location in the **United States**.
    - Includes US states (abbreviations or full names).
    - Recognizable US cities or ZIP code formats.
    - Mentions of USA, U.S.A., United States.
    
  - Reply "false" if the input is outside the United States or unclear.
  
  Strict rule: Output must be exactly "true" or "false". No explanations, no extra text.`,
          },
          {
            role: "user",
            content: addressText,
          },
        ],
        temperature: 0,
        num_predict: 5,
        stream: false,
      }),
    });

    const data = await response.json();

    // Ollama chat API usually responds like { message: { content: "true" } }
    const replyContent = data.message?.content?.trim().toLowerCase();

    console.log("AI US classification result:", replyContent);

    return replyContent === "true";
  } catch (err) {
    console.error("Error classifying with AI:", err);
    return false;
  }
}

async function isAddressUsBased(
  { address = "", city = "", state = "", zip = "", country = "" } = {},
  setCurrentState
) {
  const fields = { address, city, state, zip, country };
  console.log(colorize("Analyzing Address if US based ...", "blue"));
  setCurrentState("Analyzing Address...");
  console.log(fields);

  // Make a unified array of all field values
  const allValues = Object.values(fields).filter(Boolean);

  // 1. explicit country mentions
  if (allValues.some((val) => regexes.countryUsa.test(val))) {
    console.log(colorize("Country is US based", "green"));
    return true;
  }

  // 2. state abbreviations or full names in any field
  if (
    allValues.some(
      (val) =>
        regexes.stateAbbreviations.test(val) || regexes.fullStateNames.test(val)
    )
  ) {
    console.log(colorize("State is US based", "green"));
    return true;
  }

  // 3. ZIP code in any field
  if (allValues.some((val) => regexes.zip.test(val))) {
    console.log(colorize("ZIP is US based", "green"));
    return true;
  }

  // 4. well-known US city names in any field
  if (allValues.some((val) => regexes.usCities.test(val))) {
    console.log(colorize("City is US based", "green"));
    return true;
  }

  // 5. city+state combos (like "Boston, MA") in any field
  if (allValues.some((val) => regexes.cityStateCombo.test(val))) {
    console.log(colorize("City-State combo is US based", "green"));
    return true;
  }

  // 6. fallback: combine address + city + state
  const combined = `${address} ${city} ${state}`.trim();
  if (
    regexes.stateAbbreviations.test(combined) ||
    regexes.fullStateNames.test(combined) ||
    regexes.zip.test(combined)
  ) {
    console.log(colorize("Combined address is US based", "green"));
    return true;
  }

  // 7. Last resort → Ask AI model
  console.log(colorize("Regex inconclusive, asking AI model ...", "yellow"));
  const aiResult = await isUSByAI(
    `${address} ${city} ${state} ${zip} ${country}`
  );
  if (aiResult) {
    console.log(colorize("AI confirmed: US based", "green"));
    return true;
  }

  console.log(colorize("Address not US based", "red"));
  return false;
}

async function isWebsiteUsBased(url) {
  if (!url) {
    throw new Error("URL is required");
  }
  console.log(colorize("checking if website is US based ...", "blue"));
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

  let parsed;
  try {
    parsed = JSON.parse(result);
  } catch (err) {
    console.error("Failed to parse JSON from Python:", err);
    throw new Error("Invalid JSON from Python script");
  }

  // ✅ Return only true or false
  return parsed.isUs === 1;
}

async function isActuallyInterested(emailReply, addTotalEnterestedLLM) {
  if (!emailReply || typeof emailReply !== "string") {
    return false;
  }
  console.log(emailReply)
  console.log("------------------- emailReply -------------------")
  // 1. Normalize text
  const text = emailReply.trim().toLowerCase();
  // 2. Quick rule-based filters
  const autoReplyPatterns = [
    /out of office/,
    /auto-reply/,
    /thank you for your email/i,
    /i am currently/i,
  ];
  const promoPatterns = [
    /\bwe (offer|provide)\b/,
    /\bcheck out our\b/,
    /visit our website/,
    /our services include/,
  ];
  const interestPatterns = [
    /\bmore details\b/,
    /\bhow does\b/,
    /\blet['’]?s schedule\b/,
    /\bwhen can you\b/,
    /\bpricing\b/,
    /\bi would like\b/,
    /\bwe need\b/,
    /\bagree to\b/,
  ];

  if (
    autoReplyPatterns.some((rx) => rx.test(text)) ||
    promoPatterns.some((rx) => rx.test(text)) ||
    /no thanks|\bnot interested\b/.test(text)
  ) {
    return false;
  }

  if (interestPatterns.some((rx) => rx.test(text))) {
    return true;
  }

  // 3. LLM fallback with strict prompt
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "x-ai/grok-4-fast:free",
        messages: [
          {
            role: "system",
            content: [
              "Classify whether the following email reply from a prospect shows genuine interest",
              "—asking for pricing, next steps, scheduling, or more info.",
              "Ignore promotional pitches and auto-replies.",
              'Answer strictly "true" or "false".',
            ].join(" "),
          },
          { role: "user", content: text },
        ],
        temperature: 0,
      }),
    });
    clearTimeout(timeout);

    const json = await resp.json();
    const modelOut = json.choices?.[0]?.message?.content?.trim().toLowerCase();

    if (modelOut === "true") {
      console.log(colorize("LLM classification True", "green"));
      if (typeof addTotalEnterestedLLM === "function") {
        addTotalEnterestedLLM(1); // increment by 1
      }
    } else {
      console.log(colorize("LLM classification False", "red"));
    }

    // console.log("LLM classification:", modelOut);
    return modelOut === "true";
  } catch (err) {
    console.error("Classification error:", err);
    return false;
  }
}

async function encodeToSheet(
  spreadsheetId,
  sheetName,
  rowJson,
  addToTotalEncoded
) {
  const { sheets } = await initGoogleClients();

  // Step 1: Get sheet list
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existingSheetNames = spreadsheet.data.sheets.map(
    (s) => s.properties.title
  );

  // Step 2: If sheet doesn’t exist, create it and add headers
  if (!existingSheetNames.includes(sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    // Insert headers (keys of rowJson)
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [Object.keys(rowJson)],
      },
    });
  }

  // Step 3: Fetch existing rows
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  const existingValues = existing.data.values || [];
  const headers = existingValues[0] || [];

  // Find the index of "lead email" and "email reply"
  const leadEmailIndex = headers.indexOf("lead email");
  const emailReplyIndex = headers.indexOf("email reply");

  if (leadEmailIndex === -1 || emailReplyIndex === -1) {
    throw new Error(
      `"lead email" or "email reply" column not found in sheet: ${sheetName}`
    );
  }

  // Collect existing lead emails and replies
  const existingLeadEmails = new Set(
    existingValues
      .slice(1)
      .map((row) => row[leadEmailIndex]?.toLowerCase().trim())
      .filter(Boolean)
  );
  const existingEmailReplies = new Set(
    existingValues
      .slice(1)
      .map((row) => row[emailReplyIndex]?.toLowerCase().trim())
      .filter(Boolean)
  );

  const newLeadEmail = (rowJson["lead email"] || "").toLowerCase().trim();
  const newEmailReply = (rowJson["email reply"] || "").toLowerCase().trim();
  // Step 4: Skip if either lead email OR email reply already exists
  if (existingLeadEmails.has(newLeadEmail)) {
    console.log(
      `Lead email "${newLeadEmail}" already exists in ${sheetName}, skipping append.`
    );
    return false;
  }

  if (existingEmailReplies.has(newEmailReply)) {
    console.log(`Email reply already exists in ${sheetName}, skipping append.`);
    return false;
  }

  // Step 5: Append new row values (aligned with headers order)
  const values = [headers.map((h) => rowJson[h] ?? "")];
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    requestBody: { values },
  });
  console.log(colorize(`Row appended to ${sheetName}`, "green"));
  if (typeof addToTotalEncoded === "function") {
    addToTotalEncoded(1); // increment by 1
  }
  return true;
}

module.exports = {
  normalizeRow,
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
  encodeToSheet,
};
