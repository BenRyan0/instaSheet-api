const env = require("../../../env");
const { colorize } = require("../../../utils/colorLogger");
const { spawn } = require("child_process");
const { patterns } = require("../../../Filters/addressRegexConfig.json");

// Compile regexes once
const regexes = Object.fromEntries(
  Object.entries(patterns).map(([key, { pattern, flags }]) => [
    key,
    new RegExp(pattern, flags),
  ])
);

async function isUSByAI({
  addressText,
  setErrorOccurred,
  setErrorContext,
  keyIndex = 0,
}) {
  if (!addressText || addressText.trim() === "") return false;

  // --- Clean input ---
  const cleanedText = addressText
    .split(/\s+/)
    .filter(
      (part) =>
        part &&
        part.trim() !== "" &&
        !["none", "n/a", "na"].includes(part.trim().toLowerCase())
    )
    .join(" ")
    .trim();

  if (!cleanedText) return false;
  console.log("Cleaned Address Text:", cleanedText);
  console.log("---------- cleanedText ----------");

  try {
    // --- OpenRouter Setup ---
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const apiKeys = [
      env.OPENROUTER_API_KEY3,
      env.OPENROUTER_API_KEY2,
      env.OPENROUTER_API_KEY,
    ].filter(Boolean);

    if (!apiKeys.length) {
      console.error("No OpenRouter API keys found.");
      if (setErrorOccurred) setErrorOccurred(true);
      if (setErrorContext) setErrorContext("No OpenRouter API keys found.");
      return false;
    }

    const currentKey = apiKeys[keyIndex % apiKeys.length];
    const model =
      env.OPEN_ROUTER_LOCATION_MODEL || "google/gemini-2.5-flash-lite";
    const headers = {
      Authorization: `Bearer ${currentKey}`,
      "Content-Type": "application/json",
    };

    console.log(`Using OpenRouter model: ${model} (API Key #${keyIndex + 1})`);

    const body = JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: `
            You are a strict location classifier.  
            Return only "true" or "false".

            ### RULES:
            - Reply "true" if the input clearly or strongly suggests a location in the **United States or Canada**:
              - Mentions a U.S. state or Canadian province (abbreviation or full name).
              - Includes recognizable U.S. or Canadian cities (e.g. "Chicago", "Toronto", "Vancouver", "New York").
              - Mentions ZIP or postal codes typical of the U.S. or Canada.
              - Contains keywords like "USA", "U.S.A.", "United States", or "Canada".
            - Reply "false" if the input is outside these regions or unclear.
            - No explanations. Only respond with one lowercase word: "true" or "false".
`,
        },
        { role: "user", content: cleanedText },
      ],
      temperature: 0,
    });

    // --- Make request with timeout ---
    const resp = await fetchWithTimeout(
      url,
      { method: "POST", headers, body },
      60000
    );

    console.log("OpenRouter Response Status:", resp.status);

    // --- Handle Rate Limiting & Errors ---
    if (!resp.ok) {
      console.error("OpenRouter Error:", resp.status);

      if (resp.status === 429 && keyIndex < apiKeys.length - 1) {
        const delay = 2000 * (keyIndex + 1);
        console.warn(
          `Rate limited on key #${keyIndex + 1}. Retrying in ${
            delay / 1000
          }s...`
        );
        await new Promise((r) => setTimeout(r, delay));
        return await isUSByAI({
          addressText,
          setErrorOccurred,
          setErrorContext,
          keyIndex: keyIndex + 1,
        });
      }

      if (setErrorOccurred) setErrorOccurred(true);
      if (setErrorContext) setErrorContext(`HTTP ${resp.status}`);
      return false;
    }

    // --- Parse Response ---
    const data = await resp.json();
    const reply =
      data.choices?.[0]?.message?.content?.trim().toLowerCase() ||
      data.choices?.[0]?.text?.trim().toLowerCase() ||
      "";

    console.log("AI US/Canada classification result:", reply);

    if (reply === "true") return true;
    if (reply === "false") return false;

    console.warn("Unexpected AI response, falling back:", reply);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(`Unexpected reply: ${reply}`);
    return false;
  } catch (error) {
    console.error("Error calling OpenRouter:", error);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(`isUSByAI: ${error.message}`);
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

    //  Helper to test a regex on all values or combined text
    const matchesAny = (regex) =>
      allValues.some((val) => regex.test(val)) || regex.test(combinedText);

    // 1️  Explicit U.S. country mentions
    if (matchesAny(regexes.countryUsa)) {
      console.log(colorize("Matched US country reference", "green"));
      return true;
    }

    // 2️ State abbreviations or full names (even if inside city)
    if (
      matchesAny(regexes.stateAbbreviations) ||
      matchesAny(regexes.fullStateNames)
    ) {
      console.log(colorize("Matched US state name or abbreviation", "green"));
      return true;
    }

    // 3️ ZIP code (5-digit or ZIP+4)
    if (matchesAny(regexes.zip)) {
      console.log(colorize("Matched US ZIP code", "green"));
      return true;
    }

    // 4️ Well-known US city names (may appear in state field)
    if (matchesAny(regexes.usCities)) {
      console.log(colorize("Matched common US city name", "green"));
      return true;
    }

    // 5️ City+State combos (works even if city/state swapped)
    if (
      matchesAny(regexes.cityStateCombo) ||
      /[A-Za-z\s]+,\s*[A-Z]{2}\b/i.test(combinedText)
    ) {
      console.log(colorize("Matched City-State combo pattern", "green"));
      return true;
    }

    // 6️ US/Canada phone number
    const phoneMatch = allValues.find((val) => regexes.phoneUsCanada.test(val));
    if (phoneMatch) {
      const countryPrefix = phoneMatch.trim().startsWith("+1")
        ? "US/Canada (+1)"
        : "Possibly US/Canada format";
      console.log(colorize(`Matched phone format: ${countryPrefix}`, "green"));
      return true;
    }

    // 7️ Contextual heuristic: check mixed text combos
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

    // 8️ Last resort: call AI model if regex inconclusive
    console.log(colorize("Regex inconclusive, asking AI model ...", "yellow"));
    console.log("------ combinedText ------");
    console.log(combinedText);
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
    if (setErrorContext) setErrorContext(`isAddressUsBased: ${error.message}`);
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
  /\b give me a call\b/,
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

// --- Helper: Safe Fetch with Timeout ---
async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function isActuallyInterested(emailReply, addTotalInterestedLLM) {
  if (!emailReply || typeof emailReply !== "string" || !emailReply.trim()) {
    console.warn("Skipping empty or invalid email reply");
    return false;
  }

  const text = normalize(emailReply);
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const apiKeys = [
    env.OPENROUTER_API_KEY,
    env.OPENROUTER_API_KEY2,
    env.OPENROUTER_API_KEY3,
  ].filter(Boolean);

  const model = env.OPEN_ROUTER_MODEL2 || "openai/gpt-5-chat";

  if (!apiKeys.length) {
    console.error("No OpenRouter API keys available → using rule-based fallback.");
    return ruleBasedCheck(text);
  }

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    const keyIndex = attempt % apiKeys.length;
    const currentKey = apiKeys[keyIndex];

    console.log(
      `Attempt #${attempt + 1} using OpenRouter model: ${model} (API Key #${keyIndex + 1})`
    );

    try {
      const headers = {
        Authorization: `Bearer ${currentKey}`,
        "Content-Type": "application/json",
      };

      const resp = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `
                You are an assistant that determines if an email reply shows genuine *interest* in the funding offer described below.

                ### OFFER CONTEXT
                We provide working capital or cash advances to businesses based on their gross receipts.
                - Credit score does not affect eligibility.
                - Funding can be released within 24 hours.

                ### YOUR TASK
                Analyze the email reply and classify it as **true** (interested) or **false** (not interested).

                ### CLASSIFY AS TRUE IF:
                - The reply shows curiosity, openness, or willingness to continue the conversation.
                - The sender asks for a summary, information, or clarification — even briefly.
                - The reply includes positive or permissive phrases such as:
                  "Yes", "Sure", "Okay", "Fine", "Go ahead", "Send it", "Please send info",
                  "A brief summary is fine", "Tell me more", "Interested", "Let's talk",
                  "Give me a call", "We need funding", "What are the terms?"
                - The tone is polite and allows engagement.
                - The sender refers you to another person handling funding or finance decisions.

                ### CLASSIFY AS FALSE IF:
                - The reply rejects the offer: "Not interested", "No thanks", "We already got funding", "Stop emailing me".
                - The reply requests something unrelated (grants, jobs, donations, etc.).
                - The reply is automated or non-human ("Received", "Out of office", "Unsubscribe").
                - The reply expresses negative sentiment toward the offer.

                Respond strictly with one lowercase word: **true** or **false**.
              `,
              },
              { role: "user", content: text },
            ],
            temperature: 0,
          }),
        },
        60000 // 60s timeout
      );

      console.log("Response status:", resp.status);

      // HTTP error handling
      if (!resp.ok) {
        console.warn(`HTTP error ${resp.status} on attempt #${attempt + 1}`);
        attempt++;
        await new Promise((r) => setTimeout(r, 2000 * attempt)); // linear backoff
        continue;
      }

      const json = await resp.json();
      const modelOut =
        json.choices?.[0]?.message?.content?.trim()?.toLowerCase() ||
        json.choices?.[0]?.text?.trim()?.toLowerCase() ||
        "";

      const normalizedOut =
        (modelOut.match(
          /\b(true|false|yes|no|interested|not interested)\b/i
        ) || [])[1]?.toLowerCase() || "";

      if (!normalizedOut) {
        console.warn(`Unexpected LLM output: "${modelOut}"`);
        attempt++;
        continue; // retry again
      }

      if (["true", "yes", "interested"].includes(normalizedOut)) {
        console.log("Classified as: TRUE (interested)");
        if (typeof addTotalInterestedLLM === "function")
          addTotalInterestedLLM(1);
        return true;
      }

      if (["false", "no", "not interested"].includes(normalizedOut)) {
        console.log("Classified as: FALSE (not interested)");
        return false;
      }

      // Unrecognized → treat as false
      console.warn(`Unrecognized classification output: "${modelOut}"`);
      return false;
    } catch (err) {
      console.error(
        `Attempt #${attempt + 1} failed (${err.name}: ${err.message})`
      );
      attempt++;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }

  // --- Final fallback after all attempts ---
  console.warn("All retries failed → using rule-based fallback check...");
  const ruleResult = ruleBasedCheck(text);
  console.log(`Rule-based fallback result: ${ruleResult ? "TRUE" : "FALSE"}`);
  return ruleResult;
}


// --- Main Function: Classify Interest ---
// async function isActuallyInterested(
//   emailReply,
//   addTotalInterestedLLM,
//   useLocal = false,
//   keyIndex = 0
// ) {
//   if (!emailReply || typeof emailReply !== "string" || !emailReply.trim()) {
//     console.warn("Skipping empty or invalid email reply");
//     return false;
//   }

//   const text = normalize(emailReply);

//   try {
//     // --- Local Fallback Shortcut ---
//     if (useLocal) {
//       console.warn("Using local fallback → sending to n8n webhook...");
//       return await sendToN8nWebhook(emailReply);
//     }

//     // --- API Setup ---
//     const url = "https://openrouter.ai/api/v1/chat/completions";
//     const apiKeys = [
//       env.OPENROUTER_API_KEY,
//       env.OPENROUTER_API_KEY2,
//       env.OPENROUTER_API_KEY3,
//     ].filter(Boolean);

//     if (!apiKeys.length) {
//       console.error("No OpenRouter API keys available → using n8n fallback.");
//       return await sendToN8nWebhook(emailReply);
//     }

//     const currentKey = apiKeys[keyIndex % apiKeys.length];
//     const headers = {
//       Authorization: `Bearer ${currentKey}`,
//       "Content-Type": "application/json",
//     };
//     const model = env.OPEN_ROUTER_MODEL2 || "openai/gpt-5-chat";
//     console.log(`Using OpenRouter model: ${model} (API Key #${keyIndex + 1})`);

//     // --- Fetch with timeout protection ---
//     const resp = await fetchWithTimeout(
//       url,
//       {
//         method: "POST",
//         headers,
//         body: JSON.stringify({
//           model,
//           messages: [
//             {
//               role: "system",
//               content: `
//                   You are an assistant that determines if an email reply shows genuine *interest* in the funding offer described below.

//                   ### OFFER CONTEXT
//                   We provide working capital or cash advances to businesses based on their gross receipts.
//                   - Credit score does not affect eligibility.
//                   - Funding can be released within 24 hours.

//                   ### YOUR TASK
//                   Analyze the email reply and classify it as **true** (interested) or **false** (not interested).

//                   ### CLASSIFY AS TRUE IF:
//                   - The reply shows curiosity, openness, or willingness to continue the conversation.
//                   - The sender asks for a summary, information, or clarification — even briefly.
//                   - The reply includes positive or permissive phrases such as:
//                     "Yes", "Sure", "Okay", "Fine", "Go ahead", "Send it", "Please send info",
//                     "A brief summary is fine", "Tell me more", "Interested", "Let's talk",
//                     "Give me a call", "We need funding", "What are the terms?"
//                   - The tone is polite and allows engagement.
//                   - The sender refers you to another person handling funding or finance decisions.

//                   ### CLASSIFY AS FALSE IF:
//                   - The reply rejects the offer: "Not interested", "No thanks", "We already got funding", "Stop emailing me".
//                   - The reply requests something unrelated (grants, jobs, donations, etc.).
//                   - The reply is automated or non-human ("Received", "Out of office", "Unsubscribe").
//                   - The reply expresses negative sentiment toward the offer.

//                   Respond strictly with one lowercase word: **true** or **false**.
//               `,
//             },
//             { role: "user", content: text },
//           ],
//           temperature: 0,
//         }),
//       },
//       60000 // 60s timeout
//     );

//     console.log("RESPONSE IN ISACTUALLYINTERESTED:", resp.status);

//     // --- Handle HTTP Errors ---
//     if (!resp.ok) {
//       console.error("LLM ERROR:", resp.status);

//       if (resp.status === 429 && keyIndex < apiKeys.length - 1) {
//         const delay = 2000 * (keyIndex + 1);
//         console.warn(
//           `Rate limited on key #${keyIndex + 1}. Retrying in ${
//             delay / 1000
//           }s...`
//         );
//         await new Promise((r) => setTimeout(r, delay));
//         return await isActuallyInterested(
//           emailReply,
//           addTotalInterestedLLM,
//           false,
//           keyIndex + 1
//         );
//       }

//       if (keyIndex >= apiKeys.length - 1) {
//         console.error("All API keys exhausted → using n8n fallback.");
//         return await isActuallyInterested(
//           emailReply,
//           addTotalInterestedLLM,
//           true
//         );
//       }

//       console.warn(`HTTP error on key #${keyIndex + 1}. Trying next key...`);
//       return await isActuallyInterested(
//         emailReply,
//         addTotalInterestedLLM,
//         false,
//         keyIndex + 1
//       );
//     }

//     // --- Parse Response Safely ---
//     const json = await resp.json();
//     const modelOut =
//       json.choices?.[0]?.message?.content?.trim()?.toLowerCase() ||
//       json.choices?.[0]?.text?.trim()?.toLowerCase() ||
//       "";

//     const normalizedOut =
//       (modelOut.match(/\b(true|false|yes|no|interested|not interested)\b/i) ||
//         [])[1]?.toLowerCase() || "";

//     if (!normalizedOut) {
//       console.warn(`Unexpected LLM output on key #${keyIndex + 1}:`, modelOut);

//       if (keyIndex === 1 && apiKeys.length > 2) {
//         console.warn("Unexpected output on Key #2 → jumping to Key #3...");
//         return await isActuallyInterested(
//           emailReply,
//           addTotalInterestedLLM,
//           false,
//           2
//         );
//       }

//       if (keyIndex < apiKeys.length - 1) {
//         console.warn(`Retrying with next API key (#${keyIndex + 2})...`);
//         return await isActuallyInterested(
//           emailReply,
//           addTotalInterestedLLM,
//           false,
//           keyIndex + 1
//         );
//       }

//       console.error("All API keys exhausted → using n8n fallback.");
//       return await isActuallyInterested(
//         emailReply,
//         addTotalInterestedLLM,
//         true
//       );
//     }

//     // --- Final Classification ---
//     if (["true", "yes", "interested"].includes(normalizedOut)) {
//       console.log("Classified as: TRUE (interested)");
//       if (typeof addTotalInterestedLLM === "function") addTotalInterestedLLM(1);
//       return true;
//     }

//     if (["false", "no", "not interested"].includes(normalizedOut)) {
//       console.log("Classified as: FALSE (not interested)");
//       return false;
//     }

//     console.warn("Unexpected classification output:", modelOut);
//   } catch (err) {
//     console.error("LLM classification error:", err.name, err.message);
//     if (err.name === "AbortError") {
//       console.warn(
//         "Request aborted due to timeout → triggering n8n fallback..."
//       );
//     }
//     return await sendToN8nWebhook(emailReply);
//   }

//   // --- Final Fallback: Rule-Based Check ---
//   const ruleResult = ruleBasedCheck(text);
//   console.log(`Fallback rule-based result: ${ruleResult ? "TRUE" : "FALSE"}`);
//   return ruleResult;
// }

// --- n8n Fallback Helper ---
async function sendToN8nWebhook(emailReply) {
  const webhookUrl = env.N8N_FALLBACK_WEBHOOK;
  if (!webhookUrl) {
    console.error("Missing N8N_FALLBACK_WEBHOOK env var — skipping fallback.");
    return false;
  }

  try {
    const resp = await fetchWithTimeout(
      webhookUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailContent: emailReply }),
      },
      15000 // 15s timeout for local webhook
    );

    if (!resp.ok) {
      console.error("n8n webhook failed:", resp.status);
      return false;
    }

    console.log("n8n webhook triggered successfully.");
    return false; // Defer classification to n8n
  } catch (err) {
    console.error("Error sending to n8n webhook:", err.message);
    return false;
  }
}

// --- n8n Fallback Helper ---
async function sendToN8nWebhook(emailReply) {
  const webhookUrl = env.N8N_FALLBACK_WEBHOOK;
  if (!webhookUrl) {
    console.error("Missing N8N_FALLBACK_WEBHOOK env var — skipping fallback.");
    return false;
  }

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailContent: emailReply }),
    });

    if (!resp.ok) {
      console.error("n8n webhook failed:", resp.status);
      return false;
    }

    console.log(" n8n webhook triggered successfully.");
    return false; // Defer classification to n8n
  } catch (err) {
    console.error("Error sending to n8n webhook:", err);
    return false;
  }
}

module.exports = {
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
};
