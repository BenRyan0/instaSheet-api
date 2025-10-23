require("dotenv").config({ silent: true });
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
    console.error("Error classifying with AI:");
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
                  "A brief summary is fine", "Tell me more", "Interested", "Let's talk", " give me a call",
                  "We need funding", "What are the terms?"
                - The tone is polite and allows engagement, even without a direct “yes.”
                - The sender expresses business-related funding interest (explicitly or implicitly).
                - The sender refers you to another person who handles funding, finance, or business decisions (e.g., "Let me give you her number", "You should talk to our owner", "I'll forward this to the manager"). This still counts as interest, since it shows engagement and willingness to connect.


                ### CLASSIFY AS FALSE IF:
                - The reply rejects or declines the offer: "Not interested", "No thanks",
                  "We already got funding", "We’ll pass", "Stop emailing me".
                - The reply requests something unrelated (grants, donations, employment, etc.).
                - The reply is neutral, automated, or non-human (e.g., “Received”, “Out of office”,
                  “Do not contact”, “Unsubscribe”).
                - The reply expresses negative sentiment toward the offer.

                ### IMPORTANT
                - Ignore polite sign-offs or pleasantries.
                - Focus on the *intent* related to the funding offer.
                - Respond with exactly one lowercase word: **true** or **false**.
                `,
          },

          { role: "user", content: text },
        ],
        temperature: 0,
      }),
    });

    console.log("RESPONSE IN ISACTUALLYINTERESTED:", resp.status);
    console.log(resp);

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


module.exports = {
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested
};
