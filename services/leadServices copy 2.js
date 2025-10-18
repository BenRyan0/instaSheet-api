require("dotenv").config({ silent: true });
const axios = require("axios");
const redisClient = require("../config/redisClient.js");
const { API_BASE, LEADS_LIST_PATH } = require("../config");
const { colorize } = require("../utils/colorLogger");

const { spawn } = require("child_process");
const { initGoogleClients } = require("../services/googleClient.js");
const readline = require("readline");
const con = require("../db/db.js");
const { getAuthHeaders } = require("../utils/auth");

const { patterns } = require("../Filters/addressRegexConfig.json");
const { responseReturn } = require("../utils/response.js");
// Compile regexes once
const regexes = Object.fromEntries(
  Object.entries(patterns).map(([key, { pattern, flags }]) => [
    key,
    new RegExp(pattern, flags),
  ])
);

const FILTER_LEAD_INTERESTED_BASE = {
  lt_interest_status: 1,
  email_reply_count: { gt: 0 },
};

// async function fetchLeadsPage({
//   campaignId,
//   cursor = null,
//   pageLimit,
//   authHeaders,
//   setErrorContext,
//   setErrorOccurred,
// }) {
//   console.log("FetchLeadsPage -init");

//   const redisCursorKey = `insta:campaign_cursor:${campaignId}:${pageLimit}`;
//   const redisFailCountKey = `insta:campaign_cursor_failcount:${campaignId}:${pageLimit}`;
//   const redisMetaKey = `insta:campaign_meta`;

//   try {
//     // Step 1: Check last used campaign + pageLimit
//     const lastMeta = JSON.parse((await redisClient.get(redisMetaKey)) || "{}");

//     const metaChanged =
//       lastMeta.campaignId !== campaignId || lastMeta.pageLimit !== pageLimit;

//     if (metaChanged) {
//       console.log(
//         `Campaign/pageLimit changed: last=${JSON.stringify(
//           lastMeta
//         )}, current={campaignId:${campaignId}, pageLimit:${pageLimit}}`
//       );
//       console.log("Resetting cursor and fail count...");
//       await redisClient.del(redisCursorKey);
//       await redisClient.del(redisFailCountKey);
//     }

//     // Step 2: Get stored cursor (if still valid)
//     let storedCursor = await redisClient.get(redisCursorKey);
//     const effectiveCursor = storedCursor || cursor || "";

//     console.log(
//       `Using cursor for campaign ${campaignId} (limit=${pageLimit}):`,
//       effectiveCursor
//     );

//     // Step 3: Build request
//     const body = {
//       filter: "FILTER_LEAD_INTERESTED",
//       campaign: campaignId,
//       in_campaign: true,
//       limit: pageLimit,
//       starting_after: effectiveCursor,
//     };

//     // Step 4: Send API request
//     const response = await axios.post(
//       `https://api.instantly.ai/api/v2/leads/list`,
//       body,
//       {
//         headers: authHeaders,
//       }
//     );

//     // console.log("Parsed response:");
//     // console.dir(response.data, { depth: null, colors: true });
//     // console.log("Response received for campaign:", campaignId);
//     // console.log(`Fetched ${response.data?.items?.length || 0} leads`);

//     const leads = response.data?.items || [];

//     // Log each email
//     console.log(colorize("Fetched Leads ...", "cyan"));
//     leads.forEach((lead, index) => {
//       console.log(colorize(`${index + 1}. ${lead.email}`, "cyan"));
//     });

//     // Step 5: Handle cursor logic
//     if (response.data?.next_starting_after) {
//       const newCursor = response.data.next_starting_after;

//       // await redisClient.set(redisCursorKey, newCursor, { EX: 3600 }); // 1 hour expiry
//       await redisClient.set(redisCursorKey, newCursor, { EX: 1800 });
//       await redisClient.del(redisFailCountKey);

//       // Store latest campaign + pageLimit metadata
//       await redisClient.set(
//         redisMetaKey,
//         JSON.stringify({ campaignId, pageLimit }),
//         { EX: 1800 }
//       );

//       console.log(
//         `Updated Redis cursor for ${campaignId} (limit=${pageLimit}): ${newCursor}`
//       );
//     } else {
//       console.log("No new cursor returned by API — keeping current cursor.");

//       const failCount =
//         (parseInt(await redisClient.get(redisFailCountKey)) || 0) + 1;
//       await redisClient.set(redisFailCountKey, failCount, { EX: 7200 });

//       console.log(
//         `No-cursor streak for ${campaignId} (limit=${pageLimit}): ${failCount} time(s)`
//       );

//       if (failCount >= 3) {
//         console.warn(
//           `No new cursor for ${campaignId} after 3 attempts — resetting cursor.`
//         );
//         await redisClient.del(redisCursorKey);
//         await redisClient.del(redisFailCountKey);
//       }
//     }

//     console.log("FetchLeadsPage END");
//     return response.data;
//   } catch (error) {
//     if (setErrorOccurred) setErrorOccurred(true);
//     if (setErrorContext) setErrorContext(error.message);
//     console.error("Error in fetchLeadsPage:", error.message);
//     throw error;
//   }
// }

async function fetchLeadsPage({
  cursor = null,
  pageLimit,
  authHeaders,
  setErrorContext,
  setErrorOccurred,
}) {
  console.log("FetchAllInterestedLeadsPage -init");

  const redisCursorKey = `insta:global_cursor:${pageLimit}`;
  const redisFailCountKey = `insta:global_cursor_failcount:${pageLimit}`;

  try {
    // Step 1: Get stored cursor (if any)
    let storedCursor = await redisClient.get(redisCursorKey);
    const effectiveCursor = storedCursor || cursor || "";

    console.log(`Using global cursor (limit=${pageLimit}):`, effectiveCursor);

    // Step 2: Build request
    const body = {
      filter: "FILTER_LEAD_INTERESTED",
      limit: pageLimit,
      starting_after: effectiveCursor,
    };

    // Step 3: Send API request
    const response = await axios.post(
      `https://api.instantly.ai/api/v2/leads/list`,
      body,
      {
        headers: authHeaders,
      }
    );

    const leads = response.data?.items || [];

    console.log(colorize("Fetched Leads ...", "cyan"));
    leads.forEach((lead, index) => {
      console.log(colorize(`${index + 1}. ${lead.email}`, "cyan"));
    });

    // Step 4: Handle cursor logic
    if (response.data?.next_starting_after) {
      const newCursor = response.data.next_starting_after;

      await redisClient.set(redisCursorKey, newCursor, { EX: 1800 });
      await redisClient.del(redisFailCountKey);

      console.log(`Updated global Redis cursor: ${newCursor}`);
    } else {
      console.log("No new cursor returned by API — keeping current cursor.");

      const failCount =
        (parseInt(await redisClient.get(redisFailCountKey)) || 0) + 1;
      await redisClient.set(redisFailCountKey, failCount, { EX: 7200 });

      console.log(`No-cursor streak: ${failCount} time(s)`);

      if (failCount >= 3) {
        console.warn("No new cursor after 3 attempts — resetting cursor.");
        await redisClient.del(redisCursorKey);
        await redisClient.del(redisFailCountKey);
      }
    }

    console.log("FetchAllInterestedLeadsPage END");
    return response.data;
  } catch (error) {
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
    console.error("Error in fetchAllInterestedLeadsPage:", error.message);
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
      console.log(response);
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
  try {
    const fields = { address, city, state, zip, country, phone };
    const allValues = Object.values(fields).filter(Boolean);

    console.log(
      colorize("Analyzing Address if US based (robust mix mode)...", "blue")
    );

    // Combine all parts for fallback testing (in case city/state swapped)
    const combinedText = `${address} ${city} ${state} ${zip} ${country}`.trim();

    // ✅ Helper to test a regex on all values or combined text
    const matchesAny = (regex) =>
      allValues.some((val) => regex.test(val)) || regex.test(combinedText);

    // 1️⃣ Explicit U.S. country mentions
    if (matchesAny(regexes.countryUsa)) {
      console.log(colorize("Matched US country reference", "green"));
      return true;
    }

    // 2️⃣ State abbreviations or full names (even if inside city)
    if (
      matchesAny(regexes.stateAbbreviations) ||
      matchesAny(regexes.fullStateNames)
    ) {
      console.log(colorize("Matched US state name or abbreviation", "green"));
      return true;
    }

    // 3️⃣ ZIP code (5-digit or ZIP+4)
    if (matchesAny(regexes.zip)) {
      console.log(colorize("Matched US ZIP code", "green"));
      return true;
    }

    // 4️⃣ Well-known US city names (may appear in state field)
    if (matchesAny(regexes.usCities)) {
      console.log(colorize("Matched common US city name", "green"));
      return true;
    }

    // 5️⃣ City+State combos (works even if city/state swapped)
    if (
      matchesAny(regexes.cityStateCombo) ||
      /[A-Za-z\s]+,\s*[A-Z]{2}\b/i.test(combinedText)
    ) {
      console.log(colorize("Matched City-State combo pattern", "green"));
      return true;
    }

    // 6️⃣ US/Canada phone number
    const phoneMatch = allValues.find((val) => regexes.phoneUsCanada.test(val));
    if (phoneMatch) {
      const countryPrefix = phoneMatch.trim().startsWith("+1")
        ? "US/Canada (+1)"
        : "Possibly US/Canada format";
      console.log(colorize(`Matched phone format: ${countryPrefix}`, "green"));
      return true;
    }

    // 7️⃣ Contextual heuristic: check mixed text combos
    const normalizedText = combinedText.toLowerCase();

    // Allow partial indicators like “usa tx”, “new york us”, “ca united states”
    const mixedPatterns = [
      /\busa\b/,
      /\bunited states\b/,
      /\bamerica\b/,
      /\b[a-z\s]+,\s*(usa|united states|us)\b/,
      /\b(usa|united states|us)\s*[a-z\s]+/,
    ];
    if (mixedPatterns.some((r) => r.test(normalizedText))) {
      console.log(colorize("Matched heuristic US phrase mix", "green"));
      return true;
    }

    // 8️⃣ Last resort: call AI model if regex inconclusive
    console.log(colorize("Regex inconclusive, asking AI model ...", "yellow"));
    const aiResult = await isUSByAI({
      addressText: combinedText,
      setErrorOccurred,
      setErrorContext,
    });

    if (aiResult) {
      console.log(colorize("AI confirmed: US based", "green"));
      return true;
    }

    console.log(colorize("Address not US based (regex + AI fallback)", "red"));
    return false;
  } catch (error) {
    console.error(error);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
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
  useLocal = false,
  keyIndex = 0 // added: track which API key to use
) {
  if (!emailReply || typeof emailReply !== "string") {
    return false;
  }

  const text = normalize(emailReply);

  const controller = new AbortController();
  let timeoutId;

  try {
    timeoutId = setTimeout(() => controller.abort(), 90000);

    // --- Select base URL + headers ---
    const url = useLocal
      ? "http://localhost:11434/api/chat"
      : "https://openrouter.ai/api/v1/chat/completions";

    // --- Cycle through keys ---
    const apiKeys = [
      process.env.OPENROUTER_API_KEY,
      process.env.OPENROUTER_API_KEY2,
      process.env.OPENROUTER_API_KEY3,
    ].filter(Boolean); // remove undefined ones

    const currentKey = apiKeys[keyIndex % apiKeys.length];

    const headers = useLocal
      ? { "Content-Type": "application/json" }
      : {
          Authorization: `Bearer ${currentKey}`,
          "Content-Type": "application/json",
        };

    const model = useLocal
      ? process.env.LOCAL_LLM
      : process.env.OPEN_ROUTER_MODEL2;

    console.log(`Using OpenRouter model: ${model} (API Key #${keyIndex + 1})`);

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
              "- Asking for more details or a meeting to discuss the offer.",
              "",
              "Mark as FALSE if the reply:",
              "- Rejects or declines the offer (e.g., 'not interested', 'we have to pass', 'no thanks').",
              "- Expresses interest in something different (e.g., grants, loans, donations).",
              "- Is neutral or automated (e.g., 'Thanks', 'Received').",
              "- Excludes your offer (e.g., 'only interested in grants').",
              "",
              "Respond with exactly one word — 'true' or 'false' — in lowercase.",
            ].join("\n"),
          },
          { role: "user", content: text },
        ],
        temperature: 0,
      }),
    });

    console.log("RESPONSE IN ISACTUALLYINTERESTED:", resp.status);

    // --- Handle HTTP errors ---
    if (!resp.ok) {
      console.error("LLM ERROR isActuallyInterested:", resp.status);

      // Rate-limit detected → retry with next API key
      if (resp.status === 429) {
        if (keyIndex < apiKeys.length - 1) {
          console.warn(
            `Rate limited on API key #${
              keyIndex + 1
            }. Retrying with next key...`
          );
          return await isActuallyInterested(
            emailReply,
            addTotalInterestedLLM,
            useLocal,
            keyIndex + 1
          );
        } else {
          console.error(
            "All OpenRouter API keys exhausted — switching to local model."
          );
          return await isActuallyInterested(
            emailReply,
            addTotalInterestedLLM,
            true // useLocal
          );
        }
      }

      return ruleBasedCheck(text);
    }

    // --- Handle JSON responses ---
    let modelOut = "";
    if (useLocal) {
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
            if (lastValid) break;
          }
        } catch (e) {
          console.warn("Skipping bad NDJSON line:", line);
        }
      }
      modelOut = (lastValid || "").toLowerCase();
      console.log("Parsed NDJSON modelOut:", modelOut);
    } else {
      const json = await resp.json();
      console.log("Parsed OpenRouter JSON:", json);
      modelOut =
        json.choices?.[0]?.message?.content?.trim()?.toLowerCase() ||
        json.choices?.[0]?.text?.trim()?.toLowerCase() ||
        "";
      console.log("Parsed OpenRouter modelOut:", modelOut);
    }

    // --- Interpret model output ---
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
  } catch (err) {
    console.error("LLM classification error:", err);
  } finally {
    clearTimeout(timeoutId);
  }

  // Fallback to rule-based check if all else fails
  return ruleBasedCheck(text);
}

// async function isActuallyInterested(
//   emailReply,
//   addTotalInterestedLLM,
//   useLocal = false
// ) {
//   // 1. Guard & normalize
//   if (!emailReply || typeof emailReply !== "string") {
//     return false;
//   }

//   const text = normalize(emailReply);

//   // 2. Try the LLM classification
//   const controller = new AbortController();
//   let timeoutId;

//   try {
//     timeoutId = setTimeout(() => controller.abort(), 90000);

//     const url = useLocal
//       ? "http://localhost:11434/api/chat"
//       : "https://openrouter.ai/api/v1/chat/completions";

//     const headers = useLocal
//       ? { "Content-Type": "application/json" }
//       : {
//           Authorization: `Bearer ${process.env.OPENROUTER_API_SEC_KEY}`,
//           "Content-Type": "application/json",
//         };

//     const model = useLocal
//       ? process.env.LOCAL_LLM
//       : process.env.OPEN_ROUTER_MODEL2;

//     console.log(`model OPENROUTER_API_SEC_KEY : ${model}`);

//     const resp = await fetch(url, {
//       method: "POST",
//       headers,
//       signal: controller.signal,
//       body: JSON.stringify({
//         model,
//         messages: [
//           {
//             role: "system",
//             content: [
//               "You are an assistant that classifies whether a prospect's email reply shows genuine business interest in the offered service.",
//               "",
//               "SERVICES OFFERED:",
//               "- We provide funding or cash advances based on business gross receipts.",
//               "- Credit history does not affect eligibility.",
//               "- Funding can be released within 24 hours or sooner.",
//               "",
//               "Classify the reply as TRUE or FALSE according to the following:",
//               "",
//               "Mark as TRUE if the reply:",
//               "- Expresses curiosity, intent, or engagement about *receiving funding based on business performance*.",
//               "- Asks for details, requirements, terms, next steps, or timing of funding.",
//               "- Shows positive or open-ended responses like 'Yes', 'Sure', 'Tell me more', or 'Let's talk'.",
//               "- Indicates willingness to discuss your specific funding service.",
//               "- Asking for more details and questions about the offer (e.g. ,Do you fund business acquisitions?)",
//               "- Asking for a call or meeting to discuss the offer (e.g. Can we schedule a call to discuss?)",
//               "",
//               "Mark as FALSE if the reply:",
//               "- Rejects or declines the offer (e.g., 'not interested', 'we have to pass', 'no thanks').",
//               "- Expresses interest in something different from what is offered (e.g., only grants, loans, investments, or donations).",
//               "- Is neutral, generic, or automated (e.g., 'Thanks', 'Received', 'Got it').",
//               "- Contains conditions that exclude your type of offer (e.g., 'only interested in grants' or 'not open to funding').",
//               "",
//               "Respond with exactly one word — 'true' or 'false' — in lowercase. No punctuation or explanation.",
//             ].join("\\n"),
//           },
//           { role: "user", content: text },
//         ],
//         temperature: 0,
//       }),
//     });

//     console.log("RESPONSE IN ISACTUALLYINTERESTED");
//     console.log(resp);

//     if (!resp.ok) {
//       console.error("LLM ERROR isActuallyInterested:", resp.status);
//       // if (setErrorOccurred) setErrorOccurred(true);
//       // throw new Error(`HTTP ${resp.status}`);
//     }

//     // --- Handle local NDJSON vs OpenRouter JSON ---
//     let modelOut = "";

//     if (useLocal) {
//       // NDJSON stream parsing
//       const raw = await resp.text();
//       const lines = raw
//         .split("\n")
//         .map((l) => l.trim())
//         .filter((l) => l.length > 0);

//       let lastValid = null;
//       for (let line of lines) {
//         try {
//           const obj = JSON.parse(line);
//           if (obj?.message?.content) {
//             lastValid = obj.message.content.trim();
//             if (lastValid) break; // take the first non-empty response
//           }
//         } catch (e) {
//           console.warn("Skipping bad NDJSON line:", line);
//         }
//       }

//       modelOut = (lastValid || "").toLowerCase();
//       console.log("Parsed NDJSON modelOut:", modelOut);
//     } else {
//       // OpenRouter JSON
//       const json = await resp.json();
//       console.log("Parsed OpenRouter JSON:", json);

//       modelOut =
//         json.choices?.[0]?.message?.content?.trim()?.toLowerCase() ||
//         json.choices?.[0]?.text?.trim()?.toLowerCase() ||
//         "";
//       console.log("Parsed OpenRouter modelOut:", modelOut);
//     }

//     // --- Interpret model output ---
//     // Handle extra artifacts like "false<|begin_of_sentence|>" by sanitizing
//     const tokenMatch = (modelOut.match(
//       /\b(true|false|yes|no|interested|not interested)\b/i
//     ) || [])[1];
//     const normalizedOut = (tokenMatch || modelOut)
//       .toString()
//       .toLowerCase()
//       .trim();

//     if (
//       ["true", "yes", "interested"].includes(normalizedOut) ||
//       modelOut.includes("true")
//     ) {
//       if (typeof addTotalInterestedLLM === "function") {
//         addTotalInterestedLLM(1);
//       }
//       return true;
//     }

//     if (
//       ["false", "no", "not interested"].includes(normalizedOut) ||
//       modelOut.includes("false")
//     ) {
//       return false;
//     }

//     console.warn("LLM gave unexpected output, falling back:", modelOut);

//     // If OpenRouter response is unclear and we are not using local, attempt a local LLM fallback
//     if (!useLocal) {
//       try {
//         const localController = new AbortController();
//         const localTimeout = setTimeout(() => localController.abort(), 30000);

//         const localResp = await fetch("http://localhost:11434/api/chat", {
//           method: "POST",
//           headers: { "Content-Type": "application/json" },
//           signal: localController.signal,
//           body: JSON.stringify({
//             model: process.env.LOCAL_LLM,
//             messages: [
//               {
//                 role: "system",
//                 content: [
//                   "Classify whether the following email reply from a prospect shows genuine interest",
//                   "—asking for pricing, next steps, scheduling, or more info.",
//                   "Ignore promotional pitches and auto-replies.",
//                   'Answer strictly "true" or "false".',
//                 ].join("\n"),
//               },
//               { role: "user", content: text },
//             ],
//             temperature: 0,
//             stream: false,
//           }),
//         });

//         clearTimeout(localTimeout);

//         if (localResp.ok) {
//           // Some local servers return JSON, others NDJSON; try JSON first
//           let localOut = "";
//           try {
//             const localJson = await localResp.json();
//             localOut = (localJson.message?.content || "").toLowerCase().trim();
//           } catch (_) {
//             const raw = await localResp.text();
//             const lines = raw
//               .split("\n")
//               .map((l) => l.trim())
//               .filter((l) => l.length > 0);
//             let lastValid = null;
//             for (let line of lines) {
//               try {
//                 const obj = JSON.parse(line);
//                 if (obj?.message?.content) {
//                   lastValid = obj.message.content.trim();
//                   if (lastValid) break;
//                 }
//               } catch (e) {
//                 // ignore bad lines
//               }
//             }
//             localOut = (lastValid || "").toLowerCase();
//           }

//           const localToken = (localOut.match(/\b(true|false)\b/i) || [])[1];
//           const localNorm = (localToken || localOut)
//             .toString()
//             .toLowerCase()
//             .trim();

//           if (localNorm === "true") {
//             if (typeof addTotalInterestedLLM === "function")
//               addTotalInterestedLLM(1);
//             return true;
//           }
//           if (localNorm === "false") {
//             return false;
//           }
//         }
//       } catch (fallbackErr) {
//         console.warn(
//           "Local fallback failed:",
//           fallbackErr && fallbackErr.message
//         );
//       }
//     }
//     // if (setErrorOccurred) setErrorOccurred(true);
//   } catch (err) {
//     console.error("LLM classification error:", err);
//     // if (setErrorOccurred) setErrorOccurred(true);
//   } finally {
//     clearTimeout(timeoutId);
//   }

//   // 3. Fallback to local filters if LLM fails
//   return ruleBasedCheck(text);
// }

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
      await new Promise((r) => setTimeout(r, 40000));
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

    return insertedId;
  } catch (error) {
    console.error("Error inserting lead:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(error.message);
    throw error;
  }
}

async function postAfterEncoding({
  rowJson,
  sheetUrl,
  additionalContext,
  setErrorOccurred,
  setErrorContext,
}) {
  console.log("Sending POST request with encoded row data...");

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

  const authHeaders = getAuthHeaders(process.env.PERFEX_CRM_API_KEY);

  let attempts = 0;
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  while (attempts < maxRetries) {
    try {
      const response = await axios.post(
        "https://govacrm.com/api/leads",
        reqBody,
        { headers: authHeaders }
      );

      console.log("POST request to CRM completed:", response.status);

      if (response.status === 200) {
        return true; // Success, stop retrying
      } else {
        throw new Error(`Unexpected status code: ${response.status}`);
      }

    } catch (err) {
      attempts++;
      console.error(
        `Attempt ${attempts} failed: ${err.message}${
          attempts < maxRetries ? " — retrying..." : ""
        }`
      );

      if (attempts >= maxRetries) {
        if (setErrorOccurred) setErrorOccurred(true);
        if (setErrorContext) setErrorContext(err.message);
        console.error("All retry attempts failed.");
        return false;
      }

      // Wait before retrying (exponential backoff)
      const delay = baseDelay * Math.pow(2, attempts - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// async function postAfterEncoding({
//   rowJson,
//   sheetUrl,
//   additionalContext,
//   setErrorOccurred,
//   setErrorContext,
// }) {
//   console.log("Sending POST request with encoded row data...");

//   // Build tags array dynamically
//   const tags = [];

//   // Add category tag if available
//   if (additionalContext?.Category) {
//     tags.push(additionalContext.Category);
//   }

//   const reqBody = {
//     source: "GOVA",
//     status: "NEW",
//     name: `test ${rowJson["lead first name"] || ""} ${
//       rowJson["lead last name"] || ""
//     }`.trim(),
//     assigned: "unassigned",
//     client_id: additionalContext.ClientID || "",
//     tags,
//     title: "",
//     email: rowJson["lead email"] || "",
//     website: rowJson.details || "",
//     phonenumber: rowJson["company phone#"] || "",
//     company: rowJson.company || "",
//     address: rowJson.address || "",
//     city: rowJson.city || "",
//     zip: rowJson.zip || "",
//     state: rowJson.state || "",
//     country: "",
//     default_language: "",
//     description: rowJson["email reply"] || "",
//     custom_contact_date: "",
//     is_public: sheetUrl || "",
//   };

//   try {
//     console.log(colorize("TO BE PUSHED TO THE CRM", "blue"));
//     console.log(reqBody);
//     return true;
//   } catch (err) {
//     if (setErrorOccurred) setErrorOccurred(true);
//     if (setErrorContext) setErrorContext(err.message);
//     console.error("Failed to send POST request:", err.message);
//   }
// }

// async function encodeLeadFromRequest({
//   spreadsheetId,
//   sheetName,
//   leadData, // from req.body.lead
//   setErrorOccurred,
//   setErrorContext,
// }) {
//   try {
//     const { sheets } = await initGoogleClients();
//     console.log(`Spreadsheet Id: ${spreadsheetId}`);
//     console.log(`Spreadsheet Name: ${sheetName}`);
//     console.log(`Lead Data:`);
//     console.log(leadData);

//     // 1 Ensure tab exists
//     const meta = await sheets.spreadsheets.get({ spreadsheetId });
//     const existingTabs = meta.data.sheets.map((s) => s.properties.title);

//     if (!existingTabs.includes(sheetName)) {
//       await sheets.spreadsheets.batchUpdate({
//         spreadsheetId,
//         requestBody: {
//           requests: [{ addSheet: { properties: { title: sheetName } } }],
//         },
//       });
//       console.log(`Created new sheet tab: ${sheetName}`);
//     }

//     // 2️ Construct your rowJson from the incoming leadData
//     const rowJson = {
//       "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
//       "For scheduling": leadData.for_scheduling || "",
//       "sales person": leadData.sales_person || "",
//       "sales person email": leadData.sales_person_email || "",
//       company: leadData.company || "",
//       "company phone#": leadData.company_phone || "none",
//       "phone#from email": leadData.phone_from_email || "none",
//       "lead first name": leadData.lead_first_name || "",
//       "lead last name": leadData.lead_last_name || "",
//       "lead email": leadData.lead_email || "",
//       "Column 2": leadData.lead_email || "",
//       "email reply": leadData.email_reply || "",
//       "phone 1": leadData.phone_1 || "",
//       "#": leadData.phone_number || leadData.phone_1 || "",
//       phone2: leadData.phone_2 || "",
//       address: leadData.address || "",
//       city: leadData.city || "",
//       state: leadData.state || "",
//       zip: leadData.zip || "",
//       details: leadData.details || "",
//       "Email Signature": leadData.email_signature || "",
//       "linkedin link": leadData.linkedin_link || "none",
//       "2nd contact person linked":
//         leadData.second_contact_person_linked || "none",
//       "status after the call": leadData.status_after_call || "none",
//       "number of calls spoken with the leads":
//         leadData.number_of_calls_spoken_with_leads || "",
//       "@dropdown": leadData.dropdown || "",
//     };

//     // 3️ Get existing rows
//     const resp = await sheets.spreadsheets.values.get({
//       spreadsheetId,
//       range: sheetName,
//     });

//     const allValues = resp.data.values || [];
//     let headers = allValues[0] || [];
//     const expectedHeaders = Object.keys(rowJson);

//     // If headers missing or mismatched, reset headers
//     if (!headers.length || headers.length !== expectedHeaders.length) {
//       headers = expectedHeaders;
//       await sheets.spreadsheets.values.update({
//         spreadsheetId,
//         range: `${sheetName}!A1`,
//         valueInputOption: "RAW",
//         requestBody: { values: [headers] },
//       });
//       console.log("Added or corrected headers in sheet.");
//     }

//     // 4️ Deduplication logic
//     const leadIdx = headers.indexOf("lead email");
//     const replyIdx = headers.indexOf("email reply");

//     if (leadIdx === -1 || replyIdx === -1) {
//       throw new Error(
//         `"lead email" or "email reply" columns not found in sheet "${sheetName}"`
//       );
//     }

//     const existingLeadEmails = new Set();
//     const existingPairs = new Set();

//     for (let i = 1; i < allValues.length; i++) {
//       const row = allValues[i];
//       const leadEmail = (row[leadIdx] || "").toLowerCase().trim();
//       const emailReply = (row[replyIdx] || "").toLowerCase().trim();
//       if (leadEmail) existingLeadEmails.add(leadEmail);
//       existingPairs.add(`${leadEmail}|${emailReply}`);
//     }

//     const newLeadEmail = (rowJson["lead email"] || "").toLowerCase().trim();
//     const newEmailReply = (rowJson["email reply"] || "").toLowerCase().trim();

//     if (existingLeadEmails.has(newLeadEmail)) {
//       console.log(
//         `[skip] lead email "${newLeadEmail}" already exists in "${sheetName}"`
//       );
//       return { success: false, reason: "duplicate-lead-email" };
//     }

//     const pairKey = `${newLeadEmail}|${newEmailReply}`;
//     if (existingPairs.has(pairKey)) {
//       console.log(
//         `[skip] row for lead="${newLeadEmail}" & reply="${newEmailReply}" already exists`
//       );
//       return { success: false, reason: "duplicate-lead+reply" };
//     }

//     // 5️ Append row to Google Sheet
//     const rowValues = headers.map((h) => rowJson[h] ?? "");
//     await sheets.spreadsheets.values.append({
//       spreadsheetId,
//       range: `${sheetName}!A:A`,
//       valueInputOption: "RAW",
//       insertDataOption: "INSERT_ROWS",
//       requestBody: { values: [rowValues] },
//     });

//     console.log("Lead successfully appended to Google Sheet.");

//     // 6️ Mark as done in DB (optional)
//     if (leadData.id) {
//       await con.query(
//         `UPDATE toBeEncodedLeads SET isDone = true WHERE id = $1`,
//         [leadData.id]
//       );
//       console.log(`Lead ID ${leadData.id} marked as done.`);
//     }

//     // 7️ Call postAfterEncoding
//     await incrementApprovedEncodingLead({ createdAt: leadData.created_at });

//     return { success: true };
//   } catch (error) {
//     console.error("Error encoding lead:", error.message);
//     if (setErrorOccurred) setErrorOccurred(true);
//     if (setErrorContext) setErrorContext(error.message);
//     return { success: false, error: error.message };
//   }
// }

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
  normalizeRow,
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
  encodeToSheet,
  FILTER_LEAD_INTERESTED_BASE,
  fetchLeadsPage,
  getNextCursor,
  encodeLeadFromRequest,
  markToBeApprovedLead,
};
