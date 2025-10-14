require("dotenv").config({ silent: true });
const axios = require("axios");
const redisClient = require("../config/redisClient.js");
const { API_BASE, LEADS_LIST_PATH } = require("../config");
const { colorize } = require("../utils/colorLogger");
const { patterns } = require("../Filters/addressRegexConfig.json");
const { spawn } = require("child_process");
const { initGoogleClients } = require("../services/googleClient.js");
const readline = require("readline");
const con = require("../db/db.js");
const { getAuthHeaders } = require("../utils/auth");

const regexes = {};
for (const [key, { pattern, flags }] of Object.entries(patterns)) {
  regexes[key] = new RegExp(pattern, flags);
}

const FILTER_LEAD_INTERESTED_BASE = {
  lt_interest_status: 1,
  email_reply_count: { gt: 0 },
};

async function fetchLeadsPage({
  campaignId,
  cursor = null,
  pageLimit,
  authHeaders,
  setErrorContext,
  setErrorOccurred,
}) {
  console.log("FetchLeadsPage -init");

  const redisCursorKey = `insta:campaign_cursor:${campaignId}:${pageLimit}`;
  const redisFailCountKey = `insta:campaign_cursor_failcount:${campaignId}:${pageLimit}`;
  const redisMetaKey = `insta:campaign_meta`;

  try {
    // Step 1: Check last used campaign + pageLimit
    const lastMeta = JSON.parse((await redisClient.get(redisMetaKey)) || "{}");

    const metaChanged =
      lastMeta.campaignId !== campaignId || lastMeta.pageLimit !== pageLimit;

    if (metaChanged) {
      console.log(
        `Campaign/pageLimit changed: last=${JSON.stringify(
          lastMeta
        )}, current={campaignId:${campaignId}, pageLimit:${pageLimit}}`
      );
      console.log("Resetting cursor and fail count...");
      await redisClient.del(redisCursorKey);
      await redisClient.del(redisFailCountKey);
    }

    // Step 2: Get stored cursor (if still valid)
    let storedCursor = await redisClient.get(redisCursorKey);
    const effectiveCursor = storedCursor || cursor || "";

    console.log(
      `Using cursor for campaign ${campaignId} (limit=${pageLimit}):`,
      effectiveCursor
    );

    // Step 3: Build request
    const body = {
      filter: "FILTER_LEAD_INTERESTED",
      campaign: campaignId,
      in_campaign: true,
      limit: pageLimit,
      starting_after: effectiveCursor,
    };

    // Step 4: Send API request
    const response = await axios.post(
      `https://api.instantly.ai/api/v2/leads/list`,
      body,
      {
        headers: authHeaders,
      }
    );

    // console.log("Parsed response:");
    // console.dir(response.data, { depth: null, colors: true });
    // console.log("Response received for campaign:", campaignId);
    // console.log(`Fetched ${response.data?.items?.length || 0} leads`);

    const leads = response.data?.items || [];

    // Log each email
    console.log(colorize("Fetched Leads ...", "cyan"));
    leads.forEach((lead, index) => {
      console.log(colorize(`${index + 1}. ${lead.email}`, "cyan"));
    });

    // Step 5: Handle cursor logic
    if (response.data?.next_starting_after) {
      const newCursor = response.data.next_starting_after;

      await redisClient.set(redisCursorKey, newCursor, { EX: 3600 }); // 1 hour expiry
      await redisClient.del(redisFailCountKey);

      // Store latest campaign + pageLimit metadata
      await redisClient.set(
        redisMetaKey,
        JSON.stringify({ campaignId, pageLimit }),
        { EX: 7200 }
      );

      console.log(
        `Updated Redis cursor for ${campaignId} (limit=${pageLimit}): ${newCursor}`
      );
    } else {
      console.log("No new cursor returned by API — keeping current cursor.");

      const failCount =
        (parseInt(await redisClient.get(redisFailCountKey)) || 0) + 1;
      await redisClient.set(redisFailCountKey, failCount, { EX: 7200 });

      console.log(
        `No-cursor streak for ${campaignId} (limit=${pageLimit}): ${failCount} time(s)`
      );

      if (failCount >= 3) {
        console.warn(
          `No new cursor for ${campaignId} after 3 attempts — resetting cursor.`
        );
        await redisClient.del(redisCursorKey);
        await redisClient.del(redisFailCountKey);
      }
    }

    console.log("FetchLeadsPage END");
    return response.data;
  } catch (error) {
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
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

async function isUSByAI({ addressText, setErrorOccurred, setErrorContext }) {
  if (!addressText || addressText.trim() === "") return false;

  try {
    console.log("Classifying address with AI (Ollama)...");

    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.LOCAL_LLM, // you can swap this with any local Ollama model
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
      console.log(response)
      if (setErrorOccurred) setErrorOccurred(true); // Non-200
      if (setErrorContext) setErrorContext(err.message);
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const replyContent = data.message?.content?.trim().toLowerCase();

    console.log("AI US classification result:", replyContent);

    if (replyContent === "true") return true;
    if (replyContent === "false") return false;

    // Unexpected reply → mark error
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(replyContent);
    console.warn("Unexpected AI response, falling back:", replyContent);

    return false; // fallback
  } catch (err) {
    console.error("Error classifying with AI:", err);
    if (setErrorOccurred) setErrorOccurred(true); // Mark error on failure
    if (setErrorContext) setErrorContext(err.message);
    return false;
  }
}

async function isAddressUsBased({
  address = "",
  city = "",
  state = "",
  zip = "",
  country = "",
  phone = "",
  setErrorOccurred,
  setErrorContext,
} = {}) {
  const fields = { address, city, state, zip, country, phone };
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
       // 6. phone number (US or Canada)
    if (allValues.some((val) => regexes.phoneUsCanada.test(val))) {
      const countryPrefix = val.trim().startsWith("+1") ? "US/Canada (shared +1 code)" : "Possibly US/Canada format";
      console.log(colorize(`Phone matches ${countryPrefix}`, "green"));
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
      setErrorContext,
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
  if (typeof parsed.isUs !== 1) {
    console.log(colorize("US based ...", "blue"));
  } else {
    console.log(colorize("Website not US based ...", "red"));
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
              "- Asking for a call or meeting to discuss the offer (e.g. Can we schedule a call to discuss?)",
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
  addToTotalEncoded,
  setErrorOccurred,
  setErrorContext
) {
  const { sheets } = await initGoogleClients();

  // Ensure tab exists and headers are in row 1
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTabs = meta.data.sheets.map((s) => s.properties.title);
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
        setErrorOccurred,
        setErrorContext,
      }); // ⏳ await async fallback before continuing
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

  // After successful append, run async post request before ending
  await postAfterEncoding({ rowJson, setErrorOccurred, setErrorContext });

  return appendResp.data ? true : false;
}

// Called when no user response within 30 seconds
async function appendToLeadDatabase({
  rowJson,
  setErrorOccurred,
  setErrorContext,
}) {
  const query = `
    INSERT INTO toBeEncodedLeads (
      column_1, for_scheduling, sales_person, sales_person_email, company,
      company_phone, phone_from_email, lead_first_name, lead_last_name,
      lead_email, column_2, email_reply, phone_1, phone_number, phone_2,
      address, city, state, zip, details, email_signature, linkedin_link,
      second_contact_person_linked, status_after_call,
      number_of_calls_spoken_with_leads, dropdown, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, NOW(), NOW()
    )
    RETURNING id;
  `;

  const values = [
    rowJson["Column 1"] || null,
    rowJson["For scheduling"] || null,
    rowJson["sales person"] || null,
    rowJson["sales person email"] || null,
    rowJson["company"] || null,
    rowJson["company phone#"] || null,
    rowJson["phone#from email"] || null,
    rowJson["lead first name"] || null,
    rowJson["lead last name"] || null,
    rowJson["lead email"] || null,
    rowJson["Column 2"] || null,
    rowJson["email reply"] || null,
    rowJson["phone 1"] || null,
    rowJson["#"] || null,
    rowJson["phone2"] || null,
    rowJson["address"] || null,
    rowJson["city"] || null,
    rowJson["state"] || null,
    rowJson["zip"] || null,
    rowJson["details"] || null,
    rowJson["Email Signature"] || null,
    rowJson["linkedin link"] || null,
    rowJson["2nd contact person linked"] || null,
    rowJson["status after the call"] || null,
    rowJson["number of calls spoken with the leads "] || null,
    rowJson["@dropdown"] || null,
  ];

  try {
    const result = await con.query(query, values);
    console.log(`Lead inserted successfully with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
    console.error("Error inserting lead:", error.message);
    throw error;
  }
}

// Called after successful encoding to sheet
async function postAfterEncoding({
  rowJson,
  setErrorOccurred,
  setErrorContext,
}) {
  console.log("Sending POST request with encoded row data...");

  const reqBody = {
    source: "",
    status: "",
    name: `${rowJson["lead first name"] || ""} ${
      rowJson["lead last name"] || ""
    }`.trim(),
    assigned: "",
    client_id: "",
    tags: [],
    contact: `${rowJson["lead first name"] || ""} ${
      rowJson["lead last name"] || ""
    }`.trim(),
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
    is_public: "sheet_abcdef123456",
  };

  try {
    console.log("reqBody");
    console.log(reqBody);
    // const authHeaders = getAuthHeaders(process.env.PERFEX_CRM_API_KEY);

    // const response = await axios.post(
    //   "https://govacrm.com/api/leads",
    //   reqBody,
    //   { headers: authHeaders }
    // );
    // console.log("POST request to CRM completed:", response.status);
    // if(response.status !== 200){
    //   if (setErrorOccurred) setErrorOccurred(true);
    // }

    return true;
  } catch (err) {
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(err.message);
    console.error("Failed to send POST request:", err.message);
  }
}

function normalizeLeadData(leadData, context = {}) {
  const {
    processEnvAgent = process.env.AGENT_NAME || "instaSheet agent x1",
    salesPerson,
    salesPersonEmail,
    extracted = {},
    payload = {},
    phone1,
    phone2,
    phoneFromEmail,
    firstName,
    lastName,
    leadEmail,
    emailSignature,
    lead = {},
  } = context;

  //Determine if input is from DB (snake_case) or req.body (camelCase)
  const isFromDB = Object.keys(leadData).some((key) => key.includes("_"));

  if (isFromDB) {
    // Normalize DB record → Sheet structure
    return {
      "Column 1": leadData.column_1 || processEnvAgent,
      "For scheduling": leadData.for_scheduling || "",
      "sales person": leadData.sales_person || "",
      "sales person email": leadData.sales_person_email || "",
      company: leadData.company || "",
      "company phone#": leadData.company_phone || "none",
      "phone#from email": leadData.phone_from_email || "none",
      "lead first name": leadData.lead_first_name || "",
      "lead last name": leadData.lead_last_name || "",
      "lead email": leadData.lead_email || "",
      "Column 2": leadData.column_2 || leadData.lead_email || "",
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
  } else {
    // Normalize direct payload (req.body → Sheet structure)
    return {
      "Column 1": processEnvAgent,
      "For scheduling": "",
      "sales person": salesPerson || "",
      "sales person email": salesPersonEmail || "",
      company: lead?.company_name || lead?.company || "",
      "company phone#": lead?.phone || "none",
      "phone#from email": phoneFromEmail || "none",
      "lead first name": firstName || "",
      "lead last name": lastName || "",
      "lead email": leadEmail,
      "Column 2": leadEmail,
      "email reply": extracted.reply || "",
      "phone 1": phone1 || "",
      "#": phone1 || "",
      phone2: phone2 || "",
      address: payload.address || lead?.address || "",
      city: payload.city || lead?.city || "",
      state: payload.state || lead?.state || payload.organization_state || "",
      zip:
        payload.zip ||
        payload.zip_code ||
        payload.organization_postal_code ||
        "",
      details: payload.details || lead?.details || lead?.website || "",
      "Email Signature": extracted.signature || emailSignature || "",
      "linkedin link": "none",
      "2nd contact person linked": "none",
      "status after the call": "none",
      "number of calls spoken with the leads": "",
      "@dropdown": "",
    };
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

    // 1️⃣ Ensure tab exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTabs = meta.data.sheets.map((s) => s.properties.title);

    if (!existingTabs.includes(sheetName)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
      console.log(`Created new sheet tab: ${sheetName}`);
    }

    // 2️⃣ Construct your rowJson from the incoming leadData
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

    // 3️⃣ Get existing rows
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

    // 4️⃣ Deduplication logic
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

    // 5️⃣ Append row to Google Sheet
    const rowValues = headers.map((h) => rowJson[h] ?? "");
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [rowValues] },
    });

    console.log("✅ Lead successfully appended to Google Sheet.");

    // 6️⃣ Mark as done in DB (optional)
    if (leadData.id) {
      await con.query(
        `UPDATE toBeEncodedLeads SET isDone = true WHERE id = $1`,
        [leadData.id]
      );
      console.log(`Lead ID ${leadData.id} marked as done.`);
    }

    // 7️⃣ Call postAfterEncoding
    await postAfterEncoding({ rowJson, setErrorOccurred, setErrorContext });

    return { success: true };
  } catch (error) {
    console.error("❌ Error encoding lead:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
    return { success: false, error: error.message };
  }
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
  encodeLeadFromRequest,
};
