const env = require("../../../env");
const { colorize } = require("../../../utils/colorLogger");
const { patterns } = require("../../../Filters/addressRegexConfig.json");
const { Firecrawl } = require("firecrawl");

// Compile regexes once
const regexes = Object.fromEntries(
  Object.entries(patterns).map(([key, { pattern, flags }]) => [
    key,
    new RegExp(pattern, flags),
  ])
);

const firecrawl = new Firecrawl({
  apiKey: env.FIRECRAWL_API,
});
// 🇺🇸 US keyword and address/phone indicators
const US_PATTERNS = [
  { pattern: /\bUnited States\b/i, weight: 5 },
  { pattern: /\bU\.S\.A?\b/i, weight: 5 },
  { pattern: /\bUSA\b/i, weight: 5 },
  { pattern: /\bAmerica\b/i, weight: 4 },
  { pattern: /\bAmerican Samoa\b/i, weight: 3 },
  { pattern: /\bGuam\b/i, weight: 3 },
  { pattern: /\bPuerto Rico\b/i, weight: 3 },
  { pattern: /\bU\.S\. Virgin Islands\b/i, weight: 3 },
  { pattern: /\bNorthern Mariana Islands\b/i, weight: 3 },
  { pattern: /\bU\.S\. Minor Outlying Islands\b/i, weight: 3 },
  { pattern: /\.us\b/i, weight: 3 },
  { pattern: /\.gov\b/i, weight: 3 },
  { pattern: /\.mil\b/i, weight: 3 },
  { pattern: /\$\s?\d/, weight: 1 },
  {
    pattern:
      /\b(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b/i,
    weight: 5,
  },
];

// 🇨🇦 Canada keyword and address/phone indicators
const CANADA_PATTERNS = [
  { pattern: /\bCanada\b/i, weight: 5 },
  { pattern: /\.ca\b/i, weight: 3 },
  { pattern: /\bCAD\s?\d/, weight: 1 },
  {
    pattern:
      /\b(Ottawa|Toronto|Vancouver|Calgary|Montreal|Quebec|Edmonton|Winnipeg|Saskatoon|Halifax|Victoria)\b/i,
    weight: 5,
  },
  {
    pattern:
      /\b(British Columbia|Ontario|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Prince Edward Island|Newfoundland|Quebec)\b/i,
    weight: 4,
  },
  { pattern: /\+1[-\s]?\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}\b/, weight: 2 },
];

// 🧩 NANP Area code reference sets
const US_AREA_CODES = new Set([
  201, 202, 203, 205, 206, 207, 208, 209, 210, 212, 213, 214, 215, 216, 217,
  218, 219, 220, 223, 224, 225, 228, 229, 231, 234, 239, 240, 248, 251, 252,
  253, 254, 256, 260, 262, 267, 269, 270, 272, 274, 276, 281, 283, 301, 302,
  303, 304, 305, 307, 308, 309, 310, 312, 313, 314, 315, 316, 317, 318, 319,
  320, 321, 323, 325, 327, 330, 331, 334, 336, 337, 339, 341, 346, 347, 351,
  352, 360, 361, 364, 380, 385, 386, 401, 402, 404, 405, 406, 407, 408, 409,
  410, 412, 413, 414, 415, 417, 419, 423, 424, 425, 430, 432, 434, 435, 440,
  442, 443, 458, 463, 464, 469, 470, 475, 478, 479, 480, 484, 501, 502, 503,
  504, 505, 507, 508, 509, 510, 512, 513, 515, 516, 517, 518, 520, 530, 531,
  534, 539, 540, 541, 551, 559, 561, 562, 563, 564, 567, 570, 571, 573, 574,
  575, 580, 585, 586, 601, 602, 603, 605, 606, 607, 608, 609, 610, 612, 614,
  615, 616, 617, 618, 619, 620, 623, 626, 628, 629, 630, 631, 636, 641, 646,
  650, 651, 657, 660, 661, 662, 667, 669, 678, 681, 682, 689, 701, 702, 703,
  704, 706, 707, 708, 712, 713, 714, 715, 716, 717, 718, 719, 720, 724, 725,
  727, 730, 731, 732, 734, 737, 740, 743, 747, 754, 757, 760, 762, 763, 765,
  769, 770, 772, 773, 774, 775, 779, 781, 785, 786, 801, 802, 803, 804, 805,
  806, 808, 810, 812, 813, 814, 815, 816, 817, 818, 828, 830, 831, 832, 838,
  843, 845, 847, 848, 850, 854, 856, 857, 858, 859, 860, 862, 863, 864, 865,
  870, 872, 878, 901, 903, 904, 906, 907, 908, 909, 910, 912, 913, 914, 915,
  916, 917, 918, 919, 920, 925, 927, 928, 929, 930, 931, 934, 936, 937, 938,
  940, 941, 947, 949, 951, 952, 954, 956, 959, 970, 971, 972, 973, 975, 978,
  979, 980, 984, 985, 986, 989,
]);

const CANADA_AREA_CODES = new Set([
  204, 226, 236, 249, 250, 263, 289, 306, 343, 354, 365, 367, 368, 382, 387,
  403, 416, 418, 431, 437, 438, 450, 474, 506, 514, 519, 548, 579, 581, 584,
  587, 604, 613, 639, 647, 672, 705, 709, 742, 753, 778, 780, 782, 807, 819,
  825, 867, 873, 879, 902, 905, 938, 942, 948, 958, 959,
]);

// 📞 Utility: classify phone by area code
function classifyPhoneNumber(number) {
  const cleaned = number.replace(/\D/g, "");
  const normalized =
    cleaned.length === 11 && cleaned.startsWith("1")
      ? cleaned.slice(1)
      : cleaned;

  if (normalized.length !== 10)
    return { valid: false, reason: "Invalid length" };

  const areaCode = parseInt(normalized.slice(0, 3));
  if (US_AREA_CODES.has(areaCode))
    return { valid: true, country: "US", areaCode };
  if (CANADA_AREA_CODES.has(areaCode))
    return { valid: true, country: "Canada", areaCode };

  return { valid: false, reason: "Unknown area code", areaCode };
}

async function identifyBusinessCountry(url) {
  try {
    console.log(`Scraping ${url} for country detection...`);
    const scrape = await firecrawl.scrape(url, {
      formats: ["markdown", "html"],
    });

    const description =
      scrape.metadata?.description || scrape.metadata?.ogDescription || "";

    // Combine all content sources for analysis
    const content = [
      scrape.markdown || "",
      scrape.html || "",
      JSON.stringify(scrape.metadata || {}),
      description,
    ].join(" ");

    //  Extract phone numbers and possible addresses
    const phones = content.match(/\+?\d[\d\s().-]{8,}\d/g) || [];
    const addresses = content.match(/[\w\s,.-]{10,}/g) || [];

    // Validate phones and classify by area code
    const classifiedPhones = phones.map(classifyPhoneNumber);
    const usPhones = classifiedPhones.filter(
      (p) => p.valid && p.country === "US"
    );
    const caPhones = classifiedPhones.filter(
      (p) => p.valid && p.country === "Canada"
    );

    // console.log("Classified Phones:", classifiedPhones);

    const analyze = (patterns, label) => {
      let matches = [];
      let totalWeight = 0;

      for (const { pattern, weight } of patterns) {
        const found = content.match(pattern);
        if (found) {
          matches.push({
            pattern: pattern.toString(),
            weight,
            count: found.length,
          });
          totalWeight += found.length * weight;
        }
      }

      // add weight based on phone classification
      if (label === "US" && usPhones.length > 0)
        totalWeight += usPhones.length * 4;
      if (label === "Canada" && caPhones.length > 0)
        totalWeight += caPhones.length * 4;

      // add weight from address format
      if (label === "US" && addresses.some((a) => /[A-Z]{2}\s?\d{5}/.test(a)))
        totalWeight += 4;
      if (
        label === "Canada" &&
        addresses.some((a) => /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i.test(a))
      )
        totalWeight += 4;

      return { label, totalWeight, matches };
    };

    const usResult = analyze(US_PATTERNS, "US");
    const caResult = analyze(CANADA_PATTERNS, "Canada");

    const top =
      usResult.totalWeight > caResult.totalWeight
        ? usResult
        : caResult.totalWeight > 0
        ? caResult
        : { label: "Unknown", totalWeight: 0, matches: [] };

    const confidenceRate = Math.min(
      100,
      Math.round((top.totalWeight / (top.totalWeight + 10)) * 100)
    );

    // Determine color based on percentage
    let confidenceColor = "red";
    if (confidenceRate >= 75) confidenceColor = "green";
    else if (confidenceRate >= 50) confidenceColor = "blue";
    else if (confidenceRate >= 40) confidenceColor = "orange";

    // Log with dynamic color
    console.log(
      colorize("[ COUNTRY(Inference) => ", "green"),
      colorize(`${top.label}`, "cyan"),
      colorize(`(${confidenceRate}%)`, confidenceColor),
      colorize("]", "green")
    );
    return confidenceRate >= 50;
  } catch (err) {
    console.error("Error analyzing website:", err.message || err);
    return false;
  }
}

async function isUSByAI({
  addressText,
  // setErrorOccurred,
  // setErrorContext,
  keyIndex = 0,
  runContext,
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
      if (runContext?.setErrorOccurred) {
        runContext.setErrorOccurred(true);
      }
      if (runContext?.setErrorContext)
        runContext.setErrorContext("No OpenRouter API keys found.");
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

      if (runContext?.setErrorOccurred) runContext.setErrorOccurred(true);
      if (runContext?.setErrorContext)
        runContext.setErrorContext(`HTTP ${resp.status}`);
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
    if (runContext?.setErrorOccurred) runContext.setErrorOccurred(true);
    if (runContext?.setErrorContext)
      runContext.setErrorContext(`Unexpected reply: ${reply}`);
    return false;
  } catch (error) {
    console.error("Error calling OpenRouter:", error);
    if (runContext?.setErrorOccurred) runContext.setErrorOccurred(true);
    if (runContext?.setErrorContext)
      runContext.setErrorContext(`isUSByAI: ${error.message}`);
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
  runContext,
  // setErrorOccurred,
  // setErrorContext,
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
      runContext,
      // setErrorOccurred,
      // setErrorContext,
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
    console.error(
      "No OpenRouter API keys available → using rule-based fallback."
    );
    return ruleBasedCheck(text);
  }

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    const keyIndex = attempt % apiKeys.length;
    const currentKey = apiKeys[keyIndex];

    console.log(
      `Attempt #${attempt + 1} using OpenRouter model: ${model} (API Key #${
        keyIndex + 1
      })`
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
                You are an intelligent assistant that determines the *intent* of an email reply to a business funding message.

                ---

                ### OFFER CONTEXT
                We help businesses access **working capital or merchant cash advances (MCA)** based on their gross receipts — *not their credit score*.
                - Fast approval and same-day funding (within 24 hours)
                - Designed for small and medium-sized businesses needing quick, flexible financing
                - Simple qualification process with minimal documentation

                ---

                ### YOUR TASK
                Read the email reply and decide what the sender is most likely interested in.  
                Be flexible — many people express interest indirectly (for example, by asking questions, agreeing to talk, or showing curiosity).  

                Choose **only one** of the following:

                1. **"offer"** → The sender shows *any level of interest, curiosity, or willingness to engage* about our funding offer.  
                  - They request or agree to a chat, call, or more information.  
                  - They reply positively, even with short or indirect responses such as:  
                    - “Yes”, “Sure”, “Okay”, “Sounds good”, “Chat please”, “Let’s talk”, “Can you tell me more?”, “Who are you working with?”, “What companies have you talked to?”, “Interested”, “Send details”, “Please do”.  
                  - They ask follow-up or contextual questions that suggest they’re open to learning more (e.g., “Where are you located?”, “Who handles your clients?”, “What’s the rate?”).  
                  - They forward or refer you to someone who manages financing.  
                  - *If the tone is open, curious, or conversational — treat it as “offer.”*

                2. **"sba"** → The sender specifically mentions or asks about *SBA loans* (Small Business Administration).  
                  - Mentions “SBA”, “SBA loan”, “7(a)”, “504”, “government loan”, or “small business administration”.  
                  - Asks if your company provides SBA loans or compares your offer to SBA funding.

                3. **"partnership"** → The sender is interested in *collaboration or referral opportunities*, not funding.  
                  - Mentions teaming up, cross-promotions, joint ventures, or sharing leads.

                4. **"false"** → The sender is *not interested* in funding, SBA loans, or partnership.  
                  - They reject, unsubscribe, or say they’re not looking for funding.  
                  - They request unrelated help (grants, jobs, donations, etc.).  
                  - The message is automated, out-of-office, or irrelevant.

                ---

                ### TIE-BREAK RULE
                If multiple intents appear, choose the one **most likely to lead to a continued conversation**:  
                **offer > sba > partnership > false**

                ---

                ### RESPONSE FORMAT
                Respond **only** with one of these exact lowercase words and nothing else:  
                **offer**, **sba**, **partnership**, or **false**.
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

      if (!resp.ok) {
        console.warn(`HTTP error ${resp.status} on attempt #${attempt + 1}`);
        attempt++;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      const json = await resp.json();
      const modelOut =
        json.choices?.[0]?.message?.content?.trim()?.toLowerCase() ||
        json.choices?.[0]?.text?.trim()?.toLowerCase() ||
        "";

      const normalizedOut =
        (modelOut.match(/\b(offer|partnership|sba|false)\b/i) ||
          [])[1]?.toLowerCase() || "";

      if (!normalizedOut) {
        console.warn(`Unexpected LLM output: "${modelOut}"`);
        attempt++;
        continue;
      }

      if (normalizedOut === "sba") {
        console.log("Classified as: SBA (interested in funding offer)");
        if (typeof addTotalInterestedLLM === "function")
          addTotalInterestedLLM(1);
        return { interested: true, type: "sba" };
      }

      if (normalizedOut === "offer") {
        console.log("Classified as: OFFER (interested in funding offer)");
        if (typeof addTotalInterestedLLM === "function")
          addTotalInterestedLLM(1);
        return { interested: true, type: "offer" };
      }

      if (normalizedOut === "partnership") {
        console.log("Classified as: PARTNERSHIP (interested in collaboration)");
        if (typeof addTotalInterestedLLM === "function")
          addTotalInterestedLLM(1);
        return { interested: true, type: "partnership" };
      }

      if (normalizedOut === "false") {
        console.log("Classified as: FALSE (not interested)");
        return { interested: false, type: null };
      }

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

  console.warn("All retries failed → using rule-based fallback check...");
  const ruleResult = ruleBasedCheck(text);
  console.log(`Rule-based fallback result: ${ruleResult ? "TRUE" : "FALSE"}`);
  return ruleResult;
}

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
  // isWebsiteUsBased,
  isActuallyInterested,
  identifyBusinessCountry,
};
