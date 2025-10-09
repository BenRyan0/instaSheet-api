require("dotenv").config({ silent: true });
const axios = require("axios");
const redisClient = require("../config/redisClient.js");
const { API_BASE, LEADS_LIST_PATH } = require("../config");
const { colorize } = require("../utils/colorLogger");
const { patterns } = require("../Filters/addressRegexConfig.json");
const { spawn } = require("child_process");
const { initGoogleClients } = require("../services/googleClient.js");




const regexes = {};
for (const [key, { pattern, flags }] of Object.entries(patterns)) {
  regexes[key] = new RegExp(pattern, flags);
}

const FILTER_LEAD_INTERESTED_BASE = {
  lt_interest_status: 1,
  email_reply_count: { gt: 0 },
};
// async function fetchLeadsPage({
//   campaignId,
//   cursor = null,
//   pageLimit,
//   authHeaders,
// }) {
//   console.log("FetchLeadsPage START");

//   const redisKey = `insta:campaign_cursor:${campaignId}`;

//   try {
//     //Try to get existing cursor from Redis
//     let storedCursor = await redisClient.get(redisKey);

//     // Decide which cursor to use
//     const effectiveCursor = storedCursor || cursor || "";

//     console.log(`Using cursor for campaign ${campaignId}:`, effectiveCursor);

//     //Prepare request body
//     const body = {
//       filter: "FILTER_LEAD_INTERESTED",
//       campaign: campaignId,
//       in_campaign: true,
//       limit: pageLimit,
//       starting_after: effectiveCursor,
//     };

//     //Send request
//     const response = await axios.post(`${API_BASE}${LEADS_LIST_PATH}`, body, {
//       headers: authHeaders,
//     });

//     console.log("response.data fetchLeadsPage");
//     console.dir(response.data, { depth: null, colors: true });

//     // Update cursor in Redis (if provided by API)
//     if (response.data?.next_starting_after) {
//       // Save cursor and set TTL = 1 hour (3600 seconds)
//       await redisClient.set(redisKey, response.data.next_starting_after, {
//         EX: 3600, // expires in 1 hour
//       });

//       console.log(
//         `Updated Redis cursor for ${campaignId}:`,
//         response.data.next_starting_after,
//         "(expires in 1 hour)"
//       );
//     } else {
//       console.log("No new cursor returned by API — keeping current cursor.");
//     }

//     console.log("FetchLeadsPage END");
//     return response.data;
//   } catch (error) {
//     console.error("Error in fetchLeadsPage:", error.message);
//     throw error;
//   }
// }


async function fetchLeadsPage({
  campaignId,
  cursor = null,
  pageLimit,
  authHeaders,
}) {
  console.log("FetchLeadsPage START");

  const redisKey = `insta:campaign_cursor:${campaignId}`;

  try {
    // 1️⃣ Try to get existing cursor from Redis
    let storedCursor = await redisClient.get(redisKey);

    // 2️⃣ Decide which cursor to use
    const effectiveCursor = storedCursor || cursor || "";

    console.log(`Using cursor for campaign ${campaignId}:`, effectiveCursor);

    // 3️⃣ Prepare request body
    const body = {
      filter: "FILTER_LEAD_INTERESTED",
      campaign: campaignId,
      in_campaign: true,
      limit: pageLimit,
      starting_after: effectiveCursor,
    };

    // 4️⃣ Send request
    const response = await axios.post(`${API_BASE}${LEADS_LIST_PATH}`, body, {
      headers: authHeaders,
    });

    console.log("response.data fetchLeadsPage");
    console.dir(response.data, { depth: null, colors: true });

    // 5️⃣ Update cursor in Redis (if provided by API)
    if (response.data?.next_starting_after) {
      await redisClient.set(redisKey, response.data.next_starting_after);
      console.log(
        `Updated Redis cursor for ${campaignId}:`,
        response.data.next_starting_after
      );
    } else {
      console.log("No new cursor returned by API — keeping current cursor.");
    }

    console.log("FetchLeadsPage END");
    return response.data;
  } catch (error) {
    console.error("Error in fetchLeadsPage:", error.message);
    throw error;
  }
}

function getNextCursor(apiResponse) {
  if (!Array.isArray(apiResponse) || apiResponse.length === 0) {
    return null;
  }

  const lastLead = apiResponse[apiResponse.length - 1];
  return lastLead && lastLead.id ? lastLead.id : null;
}

async function normalizeRow(emailRow) {
  return {
    "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
    "For scheduling": "",
    "sales person": emailRow["sales person"] || "",
    "sales person email": emailRow["sales person email"] || "",
    company: emailRow["company"] || "N/A",
    "company phone#":
      emailRow["company phone#"] ||
      emailRow["phone 1"] ||
      emailRow["phone2"] ||
      "none",
    "phone#from email": emailRow["phone#from email"] || "none",
    "lead first name": emailRow["lead first name"] || "",
    "lead last name": emailRow["lead last name"] || "",
    "lead email": emailRow["lead email"] || "",
    "Column 2": emailRow["lead email"] || "",
    "email reply": emailRow["email reply"] || "",
    "phone 1": emailRow["phone 1"] || "",
    "#": emailRow["phone 1"] || "",
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
   };
}

async function isUSByAI({ addressText, setErrorOccurred }) {
  if (!addressText || addressText.trim() === "") return false;

  try {
    console.log("Classifying address with AI (Ollama)...");

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.evn.LOCAL_LLM, // you can swap this with any local Ollama model
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

    if (!response.ok) {
      console.log("ERR ASKING LOCAL LLM");
      // if (setErrorOccurred) setErrorOccurred(true); // 🚨 Non-200
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const replyContent = data.message?.content?.trim().toLowerCase();

    console.log("AI US classification result:", replyContent);

    if (replyContent === "true") return true;
    if (replyContent === "false") return false;

    // 🚨 Unexpected reply → mark error
    // if (setErrorOccurred) setErrorOccurred(true);
    console.warn("Unexpected AI response, falling back:", replyContent);

    return false; // fallback
  } catch (err) {
    console.error("Error classifying with AI:", err);
    // if (setErrorOccurred) setErrorOccurred(true); // 🚨 Mark error on failure
    return false;
  }
}

async function isAddressUsBased({
  address = "",
  city = "",
  state = "",
  zip = "",
  country = "",
  setErrorOccurred,
} = {}) {
  const fields = { address, city, state, zip, country };
  console.log(
    colorize("Analyzing Address if US based - Address ONLY ...", "blue")
  );
  // Make a unified array of all field values
  const allValues = Object.values(fields).filter(Boolean);

  // 1. explicit country mentions
  try {
    if (allValues.some((val) => regexes.countryUsa.test(val))) {
      console.log(colorize("Country is US based", "green"));
      return true;
    }

    // 2. state abbreviations or full names in any field
    if (
      allValues.some(
        (val) =>
          regexes.stateAbbreviations.test(val) ||
          regexes.fullStateNames.test(val)
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
    const aiResult = await isUSByAI({
      addressText: `${address} ${city} ${state} ${zip} ${country}`,
      setErrorOccurred,
    });
    if (aiResult) {
      console.log(colorize("AI confirmed: US based", "green"));
      return true;
    }

    console.log(
      colorize("Address not US based - Address ONLY(regex-LLM)", "red")
    );
    return false;
  } catch (error) {
    console.log(error);
    return false;
  }
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

  // Return only true or false
  return parsed.isUs === 1;
}

function normalize(email) {
  return email
    .replace(/<[^>]+>/g, "")
    .replace(/(^|\n)>.*(?=\n|$)/g, "")
    .replace(/-- \r?\n[\s\S]*$/, "")
    .replace(/\r\n|\r/g, "\n")
    .trim()
    .toLowerCase();
}

// Precompiled filters
const autoReplyPatterns = [
  /out of office/,
  /auto-?reply/,
  /thank you for (your )?email/,
  /i am (currently|on).+(holiday|vacation)/,
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
  /\bwhat services do you provide\??/,
  /\b(?:yes[:,]?\s*)?interested\b/,
];

// Local rule-based check
function ruleBasedCheck(text) {
  if (
    autoReplyPatterns.some((rx) => rx.test(text)) ||
    promoPatterns.some((rx) => rx.test(text)) ||
    /no thanks|\bnot interested\b/.test(text)
  ) {
    return false;
  }
  return interestPatterns.some((rx) => rx.test(text));
}

async function isActuallyInterested(
  emailReply,
  addTotalInterestedLLM,
  useLocal = false
) {
  // 1. Guard & normalize
  if (!emailReply || typeof emailReply !== "string") {
    return false;
  }

  const text = normalize(emailReply);

  // 2. Try the LLM classification
  const controller = new AbortController();
  let timeoutId;

  try {
    timeoutId = setTimeout(() => controller.abort(), 90000);

    const url = useLocal
      ? "http://localhost:11434/api/chat"
      : "https://openrouter.ai/api/v1/chat/completions";

    const headers = useLocal
      ? { "Content-Type": "application/json" }
      : {
          Authorization: `Bearer ${process.env.OPENROUTER_API_SEC_KEY}`,
          "Content-Type": "application/json",
        };

    const model = useLocal
      ? process.env.LOCAL_LLM
      : process.env.OPEN_ROUTER_MODEL2;

    console.log(`model OPENROUTER_API_SEC_KEY : ${model}`);

    const resp = await fetch(url, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are an assistant that classifies whether a prospect's email reply shows genuine business interest in the offered service.",
              "",
              "SERVICES OFFERED:",
              "- We provide funding or cash advances based on business gross receipts.",
              "- Credit history does not affect eligibility.",
              "- Funding can be released within 24 hours or sooner.",
              "",
              "Classify the reply as TRUE or FALSE according to the following:",
              "",
              "Mark as TRUE if the reply:",
              "- Expresses curiosity, intent, or engagement about *receiving funding based on business performance*.",
              "- Asks for details, requirements, terms, next steps, or timing of funding.",
              "- Shows positive or open-ended responses like 'Yes', 'Sure', 'Tell me more', or 'Let's talk'.",
              "- Indicates willingness to discuss your specific funding service.",
              "- Asking for more details and questions about the offer (e.g. ,Do you fund business acquisitions?)",
              "",
              "Mark as FALSE if the reply:",
              "- Rejects or declines the offer (e.g., 'not interested', 'we have to pass', 'no thanks').",
              "- Expresses interest in something different from what is offered (e.g., only grants, loans, investments, or donations).",
              "- Is neutral, generic, or automated (e.g., 'Thanks', 'Received', 'Got it').",
              "- Contains conditions that exclude your type of offer (e.g., 'only interested in grants' or 'not open to funding').",
              "",
              "Respond with exactly one word — 'true' or 'false' — in lowercase. No punctuation or explanation.",
            ].join("\\n"),
          },
          { role: "user", content: text },
        ],
        temperature: 0,
      }),
    });

    console.log("RESPONSE IN ISACTUALLYINTERESTED");
    console.log(resp);

    if (!resp.ok) {
      console.error("LLM ERROR isActuallyInterested:", resp.status);
      // if (setErrorOccurred) setErrorOccurred(true);
      // throw new Error(`HTTP ${resp.status}`);
    }

    // --- Handle local NDJSON vs OpenRouter JSON ---
    let modelOut = "";

    if (useLocal) {
      // NDJSON stream parsing
      const raw = await resp.text();
      const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      let lastValid = null;
      for (let line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj?.message?.content) {
            lastValid = obj.message.content.trim();
            if (lastValid) break; // take the first non-empty response
          }
        } catch (e) {
          console.warn("Skipping bad NDJSON line:", line);
        }
      }

      modelOut = (lastValid || "").toLowerCase();
      console.log("Parsed NDJSON modelOut:", modelOut);
    } else {
      // OpenRouter JSON
      const json = await resp.json();
      console.log("Parsed OpenRouter JSON:", json);

      modelOut =
        json.choices?.[0]?.message?.content?.trim()?.toLowerCase() ||
        json.choices?.[0]?.text?.trim()?.toLowerCase() ||
        "";
      console.log("Parsed OpenRouter modelOut:", modelOut);
    }

    // --- Interpret model output ---
    // Handle extra artifacts like "false<|begin_of_sentence|>" by sanitizing
    const tokenMatch = (modelOut.match(
      /\b(true|false|yes|no|interested|not interested)\b/i
    ) || [])[1];
    const normalizedOut = (tokenMatch || modelOut)
      .toString()
      .toLowerCase()
      .trim();

    if (
      ["true", "yes", "interested"].includes(normalizedOut) ||
      modelOut.includes("true")
    ) {
      if (typeof addTotalInterestedLLM === "function") {
        addTotalInterestedLLM(1);
      }
      return true;
    }

    if (
      ["false", "no", "not interested"].includes(normalizedOut) ||
      modelOut.includes("false")
    ) {
      return false;
    }

    console.warn("LLM gave unexpected output, falling back:", modelOut);

    // If OpenRouter response is unclear and we are not using local, attempt a local LLM fallback
    if (!useLocal) {
      try {
        const localController = new AbortController();
        const localTimeout = setTimeout(() => localController.abort(), 30000);

        const localResp = await fetch("http://localhost:11434/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: localController.signal,
          body: JSON.stringify({
            model: process.env.LOCAL_LLM,
            messages: [
              {
                role: "system",
                content: [
                  "Classify whether the following email reply from a prospect shows genuine interest",
                  "—asking for pricing, next steps, scheduling, or more info.",
                  "Ignore promotional pitches and auto-replies.",
                  'Answer strictly "true" or "false".',
                ].join("\n"),
              },
              { role: "user", content: text },
            ],
            temperature: 0,
            stream: false,
          }),
        });

        clearTimeout(localTimeout);

        if (localResp.ok) {
          // Some local servers return JSON, others NDJSON; try JSON first
          let localOut = "";
          try {
            const localJson = await localResp.json();
            localOut = (localJson.message?.content || "").toLowerCase().trim();
          } catch (_) {
            const raw = await localResp.text();
            const lines = raw
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l.length > 0);
            let lastValid = null;
            for (let line of lines) {
              try {
                const obj = JSON.parse(line);
                if (obj?.message?.content) {
                  lastValid = obj.message.content.trim();
                  if (lastValid) break;
                }
              } catch (e) {
                // ignore bad lines
              }
            }
            localOut = (lastValid || "").toLowerCase();
          }

          const localToken = (localOut.match(/\b(true|false)\b/i) || [])[1];
          const localNorm = (localToken || localOut)
            .toString()
            .toLowerCase()
            .trim();

          if (localNorm === "true") {
            if (typeof addTotalInterestedLLM === "function")
              addTotalInterestedLLM(1);
            return true;
          }
          if (localNorm === "false") {
            return false;
          }
        }
      } catch (fallbackErr) {
        console.warn(
          "Local fallback failed:",
          fallbackErr && fallbackErr.message
        );
      }
    }
    // if (setErrorOccurred) setErrorOccurred(true);
  } catch (err) {
    console.error("LLM classification error:", err);
    // if (setErrorOccurred) setErrorOccurred(true);
  } finally {
    clearTimeout(timeoutId);
  }

  // 3. Fallback to local filters if LLM fails
  return ruleBasedCheck(text);
}

async function encodeToSheet(
  spreadsheetId,
  sheetName,
  rowJson,
  addToTotalEncoded
) {
  // initialize Sheets client
  const { sheets } = await initGoogleClients();

  // 1. ensure tab exists & headers are in row 1
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = meta.data.sheets.map((s) => s.properties.title);
  if (!existingTabs.includes(sheetName)) {
    // create new sheet tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });

    // write header row
    const headers = Object.keys(rowJson);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  // 2. read all existing rows
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });
  const allValues = resp.data.values || [];
  let headers = allValues[0] || [];

  // if headers are missing or mismatched, overwrite with current rowJson keys
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

  // find indices for dedupe columns
  const leadIdx = headers.indexOf("lead email");
  const replyIdx = headers.indexOf("email reply");
  if (leadIdx === -1 || replyIdx === -1) {
    throw new Error(
      `"lead email" or "email reply" columns not found in sheet "${sheetName}"`
    );
  }

  // build sets of existing data
  const existingLeadEmails = new Set();
  const existingPairs = new Set();
  for (let i = 1; i < allValues.length; i++) {
    const row = allValues[i];
    const leadEmail = (row[leadIdx] || "").toLowerCase().trim();
    const emailReply = (row[replyIdx] || "").toLowerCase().trim();
    if (leadEmail) existingLeadEmails.add(leadEmail);
    existingPairs.add(`${leadEmail}|${emailReply}`);
  }

  // normalize incoming values
  const newLeadEmail = (rowJson["lead email"] || "").toLowerCase().trim();
  const newEmailReply = (rowJson["email reply"] || "").toLowerCase().trim();

  // 3a. skip if this lead has already been written
  if (existingLeadEmails.has(newLeadEmail)) {
    console.log(
      `[skip] lead email "${newLeadEmail}" already exists in "${sheetName}"`
    );
    return false;
  }

  // 3b. skip only if this exact lead+reply pair exists
  const pairKey = `${newLeadEmail}|${newEmailReply}`;
  if (existingPairs.has(pairKey)) {
    console.log(
      `[skip] row for lead="${newLeadEmail}" & reply="${newEmailReply}" already exists`
    );
    return false;
  }

  // 4. append new row aligned to headers
  const rowValues = headers.map((h) => rowJson[h] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:A`, // always start at col A
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS", // force append at bottom
    requestBody: { values: [rowValues] },
  });
  console.log(colorize(`Appended row to "${sheetName}"`, "green"));

  // increment your counter
  if (typeof addToTotalEncoded === "function") {
    addToTotalEncoded(1);
  }

  return true;
}

module.exports = {
  normalizeRow,
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
  encodeToSheet,
  FILTER_LEAD_INTERESTED_BASE,
  fetchLeadsPage,
  getNextCursor,
};
