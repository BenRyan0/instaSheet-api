const env = require("../env");
const axios = require("axios");
const { colorize } = require("../utils/colorLogger");
const { Firecrawl } = require("firecrawl");

const firecrawl = new Firecrawl({
  apiKey: env.FIRECRAWL_API
});

function cleanEmailContent(rawEmail, maxWords = 100) {
  if (!rawEmail || typeof rawEmail !== "string") return "";
  // Remove everything starting from the first '>' line (and onward)
  let cleaned = rawEmail.split(/\n>/)[0];
  // Remove HTML tags if any
  cleaned = cleaned
    .replace(/<[^>]*>/g, "")
    // Collapse multiple newlines into one
    .replace(/\n+/g, " ")
    // Collapse multiple spaces/tabs into one
    .replace(/\s{2,}/g, " ")
    // Trim leading/trailing spaces
    .trim();
  // --- limit total words ---
  const words = cleaned.split(/\s+/);
  if (words.length > maxWords) {
    cleaned = words.slice(0, maxWords).join(" ") + "…";
  }

  return cleaned;
}

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

async function extractReply({
  emailContent,
  content_preview,
  setErrorOccurred,
  setErrorContext,
  keyIndex = 0,
}) {
  try {
    console.log(colorize("EmailContent", "cyan"));
    console.log(emailContent);

    const wordCount = emailContent?.trim().split(/\s+/).length || 0;
    let cleanedContent = emailContent;

    if (wordCount >= 20) {
      cleanedContent = cleanEmailContent(emailContent, 100);
      console.log(colorize("CleanedContent", "cyan"));
      console.log(cleanedContent);
    } else {
      cleanedContent = emailContent;
      console.log(cleanedContent);
      console.log(
        `Skipping cleanEmailContent — only ${wordCount} words detected.`
      );
    }

    if (!cleanedContent) {
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    // --- OpenRouter Setup ---
    const url = "https://openrouter.ai/api/v1/chat/completions";
    const apiKeys = [
      env.OPENROUTER_API_KEY,
      env.OPENROUTER_API_KEY2,
      env.OPENROUTER_API_KEY3,
    ].filter(Boolean);

    if (!apiKeys.length) {
      console.error("No OpenRouter API keys found.");
      if (setErrorOccurred) setErrorOccurred(true);
      return normalizeSchema({});
    }

    const currentKey = apiKeys[keyIndex % apiKeys.length];
    const model = env.OPEN_ROUTER_MODEL || "openai/gpt-5-chat";
    const headers = {
      Authorization: `Bearer ${currentKey}`,
      "Content-Type": "application/json",
    };

    console.log(`Using OpenRouter model: ${model} (API Key #${keyIndex + 1})`);

    // --- Updated System Prompt ---
    const prompt = `
       You are an email parsing assistant.

      Task: Extract the **latest human reply** from an email thread, and also extract:
      - Any phone numbers mentioned (return as a single text string).
      - The email signature block (if present).

      Rules:
      1. Find where this content preview first appears: "\${content_preview}" (case-insensitive).
      2. Collect all text until a line that matches any of these patterns:
         ^On\\s, ^From:, ^Sent:, ^To:, ^Subject:, wrote:, Forwarded message,
         Begin forwarded message, -----Original Message-----
      3. If such a marker appears on the same line, cut before it.
      4. Split the extracted text into:
         a) Main reply content
         b) Signature (if detected)
      5. The signature typically begins with:
         - "--", "–", "—"
         - "Thanks,", "Thank you,", "Best,", "Regards,", "Sincerely,"
         - or includes job title, phone, email, company info, website, or "signatureImage"
      6. Remove quoted lines (starting with ">") and collapse blank lines.
      7. Detect all phone numbers (patterns like (xxx) xxx-xxxx, xxx-xxx-xxxx, +1 xxx xxx xxxx, etc.).
         Combine multiple numbers into a comma-separated string.

      Output only a JSON object:
      {
        "reply": "cleaned_reply_text_without_signature",
        "phone_number": "comma-separated phone numbers or empty string",
        "signature": "signature_text_or_empty_string"
      }

      If nothing valid remains:
      {
        "reply": "",
        "phone_number": "",
        "signature": ""
      }
    `;

    // --- Send to OpenRouter ---
    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: cleanedContent },
      ],
      temperature: 0,
    });

    const resp = await fetchWithTimeout(
      url,
      { method: "POST", headers, body },
      60000
    );

    console.log("OpenRouter response status:", resp.status);

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
        return await extractReply({
          emailContent,
          content_preview,
          setErrorOccurred,
          setErrorContext,
          keyIndex: keyIndex + 1,
        });
      }
      if (setErrorOccurred) setErrorOccurred(true);
      return normalizeSchema({});
    }

    const json = await resp.json();
    let replyRaw =
      json.choices?.[0]?.message?.content?.trim() ||
      json.choices?.[0]?.text?.trim() ||
      "";

    // 🧹 --- NEW: Clean markdown-style code block wrappers (```json ... ```) ---
    if (/^```/m.test(replyRaw)) {
      replyRaw = replyRaw
        .replace(/^```(?:json)?/i, "") // remove opening ```json or ```
        .replace(/```$/, "") // remove closing ```
        .trim();
    }

    let parsedReply;
    try {
      parsedReply = JSON.parse(replyRaw);
    } catch {
      // --- Local fallback parsing if model output isn't JSON ---
      const phoneMatches =
        replyRaw.match(/\+?\d{1,2}?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ||
        [];
      const phoneText = phoneMatches.join(", ");
      // Try to detect signature heuristically
      const sigMatch = replyRaw.match(
        /(--|–|—|Thanks,|Thank you,|Best,|Regards,|Sincerely,)[\s\S]*$/i
      );
      const signature = sigMatch ? sigMatch[0].trim() : "";
      const reply = sigMatch
        ? replyRaw.replace(sigMatch[0], "").trim()
        : replyRaw.trim();
      parsedReply = { reply, phone_number: phoneText, signature };
    }

    // --- Normalize output ---
    const reply = parsedReply.reply || "";
    const phoneNumber =
      typeof parsedReply.phone_number === "string"
        ? parsedReply.phone_number
        : (parsedReply.phone_number || []).join(", ");
    const signature = parsedReply.signature || "";

    if (setErrorOccurred) setErrorOccurred(false);

    return normalizeSchema({ reply, phone_number: phoneNumber, signature });
  } catch (err) {
    console.error("Error calling OpenRouter:", err.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(err.message);
    return normalizeSchema({});
  }
}


// async function extractReply({
//   emailContent,
//   content_preview,
//   setErrorOccurred,
//   setErrorContext,
//   keyIndex = 0,
// }) {
//   try {
//     console.log(colorize("EmailContent", "cyan"));
//     console.log(emailContent);

//     const wordCount = emailContent?.trim().split(/\s+/).length || 0;
//     let cleanedContent = emailContent;

//     if (wordCount >= 20) {
//       cleanedContent = cleanEmailContent(emailContent, 100);
//       console.log(colorize("CleanedContent", "cyan"));
//       console.log(cleanedContent);
//     } else {
//       cleanedContent = emailContent;
//        console.log(cleanedContent);
//       console.log(
//         `Skipping cleanEmailContent — only ${wordCount} words detected.`
//       );
//     }

//     if (!cleanedContent) {
//       if (setErrorOccurred) setErrorOccurred(false);
//       return normalizeSchema({});
//     }

//     // --- OpenRouter Setup ---
//     const url = "https://openrouter.ai/api/v1/chat/completions";
//     const apiKeys = [
//       env.OPENROUTER_API_KEY,
//       env.OPENROUTER_API_KEY2,
//       env.OPENROUTER_API_KEY3,
//     ].filter(Boolean);

//     if (!apiKeys.length) {
//       console.error("No OpenRouter API keys found.");
//       if (setErrorOccurred) setErrorOccurred(true);
//       return normalizeSchema({});
//     }

//     const currentKey = apiKeys[keyIndex % apiKeys.length];
//     const model = env.OPEN_ROUTER_MODEL || "openai/gpt-5-chat";
//     const headers = {
//       Authorization: `Bearer ${currentKey}`,
//       "Content-Type": "application/json",
//     };

//     console.log(`Using OpenRouter model: ${model} (API Key #${keyIndex + 1})`);

//     // --- Updated System Prompt ---
//     const prompt = `
//        You are an email parsing assistant.

//       Task: Extract the **latest human reply** from an email thread, and also extract:
//       - Any phone numbers mentioned (return as a single text string).
//       - The email signature block (if present).

//       Rules:
//       1. Find where this content preview first appears: "\${content_preview}" (case-insensitive).
//       2. Collect all text until a line that matches any of these patterns:
//          ^On\\s, ^From:, ^Sent:, ^To:, ^Subject:, wrote:, Forwarded message,
//          Begin forwarded message, -----Original Message-----
//       3. If such a marker appears on the same line, cut before it.
//       4. Split the extracted text into:
//          a) Main reply content
//          b) Signature (if detected)
//       5. The signature typically begins with:
//          - "--", "–", "—"
//          - "Thanks,", "Thank you,", "Best,", "Regards,", "Sincerely,"
//          - or includes job title, phone, email, company info, website, or "signatureImage"
//       6. Remove quoted lines (starting with ">") and collapse blank lines.
//       7. Detect all phone numbers (patterns like (xxx) xxx-xxxx, xxx-xxx-xxxx, +1 xxx xxx xxxx, etc.).
//          Combine multiple numbers into a comma-separated string.

//       Output only a JSON object:
//       {
//         "reply": "cleaned_reply_text_without_signature",
//         "phone_number": "comma-separated phone numbers or empty string",
//         "signature": "signature_text_or_empty_string"
//       }

//       If nothing valid remains:
//       {
//         "reply": "",
//         "phone_number": "",
//         "signature": ""
//       }
//     `;

//     // --- Send to OpenRouter ---
//     const body = JSON.stringify({
//       model,
//       messages: [
//         { role: "system", content: prompt },
//         { role: "user", content: cleanedContent },
//       ],
//       temperature: 0,
//     });

//     const resp = await fetchWithTimeout(
//       url,
//       { method: "POST", headers, body },
//       60000
//     );

//     console.log("OpenRouter response status:", resp.status);

//     if (!resp.ok) {
//       console.error("OpenRouter Error:", resp.status);
//       if (resp.status === 429 && keyIndex < apiKeys.length - 1) {
//         const delay = 2000 * (keyIndex + 1);
//         console.warn(
//           `Rate limited on key #${keyIndex + 1}. Retrying in ${
//             delay / 1000
//           }s...`
//         );
//         await new Promise((r) => setTimeout(r, delay));
//         return await extractReply({
//           emailContent,
//           content_preview,
//           setErrorOccurred,
//           setErrorContext,
//           keyIndex: keyIndex + 1,
//         });
//       }
//       if (setErrorOccurred) setErrorOccurred(true);
//       return normalizeSchema({});
//     }

//     const json = await resp.json();
//     const replyRaw =
//       json.choices?.[0]?.message?.content?.trim() ||
//       json.choices?.[0]?.text?.trim() ||
//       "";

//     let parsedReply;
//     try {
//       parsedReply = JSON.parse(replyRaw);
//     } catch {
//       // --- Local fallback parsing if model output isn't JSON ---
//       const phoneMatches =
//         replyRaw.match(/\+?\d{1,2}?\s*\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ||
//         [];
//       const phoneText = phoneMatches.join(", ");
//       // Try to detect signature heuristically
//       const sigMatch = replyRaw.match(
//         /(--|–|—|Thanks,|Thank you,|Best,|Regards,|Sincerely,)[\\s\\S]*$/i
//       );
//       const signature = sigMatch ? sigMatch[0].trim() : "";
//       const reply = sigMatch
//         ? replyRaw.replace(sigMatch[0], "").trim()
//         : replyRaw.trim();
//       parsedReply = { reply, phone_number: phoneText, signature };
//     }

//     // --- Normalize output ---
//     const reply = parsedReply.reply || "";
//     const phoneNumber =
//       typeof parsedReply.phone_number === "string"
//         ? parsedReply.phone_number
//         : (parsedReply.phone_number || []).join(", ");
//     const signature = parsedReply.signature || "";

//     if (setErrorOccurred) setErrorOccurred(false);

//     return normalizeSchema({ reply, phone_number: phoneNumber, signature });
//   } catch (err) {
//     console.error("Error calling OpenRouter:", err.message);
//     if (setErrorOccurred) setErrorOccurred(true);
//     if (setErrorContext) setErrorContext(err.message);
//     return normalizeSchema({});
//   }
// }

function normalizeSchema(obj = {}) {
  console.log(colorize("Extracted Data", "cyan"));
  console.log(obj);
  return {
    reply: obj.reply || "",
    phone_numbers: obj.phone_numbers,
    signature: obj.signature,
    senderFirstName: "",
    senderLastName: "",
    original: "",
    salesPerson: "",
    salesPersonEmail: "",
  };
}

async function getWebsiteData(url) {
  if (!url) {
    console.error("No URL provided.");
    return null;
  }
  try {
    const response = await firecrawl.scrape(url, {
      formats: ["markdown"],
    });

    if (!response) {
      console.warn("No response received from Firecrawl.");
      return null;
    }

 
    const description =
      response.metadata?.description ||
      response.metadata?.ogDescription ||
      "none";
    return description;
  } catch (error) {
    console.error("Firecrawl scrape error:", error.message || error);
    return null;
  }
}

async function extractBusinessDescription({
  websiteUrl,
  serpApiKey = process.env.SERPAPI_KEY,
  setErrorOccurred,
  setErrorContext,
  descriptionExtraction = false, // default to true
}) {
  if (!websiteUrl) throw new Error("Website URL is required");
  if (!serpApiKey) throw new Error("SerpApi API key missing");

  // If extraction is disabled, skip API call
  if (descriptionExtraction === false) {
    console.log(
      `[extractBusinessDescription] Skipped SerpApi request for ${websiteUrl}`
    );
    setErrorOccurred?.(false);
    return { description: "none" };
  }

  const normalizedUrl = websiteUrl.replace(/^https?:\/\//, "").split("/")[0];
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const description = await getWebsiteData(normalizedUrl);

      setErrorOccurred?.(false);

      console.log(colorize("DESCRIPTION [EXTRACTED]","green"))
      return description;
    } catch (err) {
      const status = err.response?.status;
      const message =
        err.response?.data?.error ||
        err.message ||
        "Unknown error contacting SerpApi.";

      const shouldRetry = status === 503 && attempt < maxRetries;

      if (shouldRetry) {
        console.warn(
          `[extractBusinessDescription] SerpApi unavailable (attempt ${attempt}/${maxRetries}). Retrying in 3s...`
        );
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }

      if (attempt >= maxRetries) {
        console.error(
          `[extractBusinessDescription] ${websiteUrl} failed after ${maxRetries} attempts: ${message}`
        );
        setErrorOccurred?.(true);
        setErrorContext?.(message);
        return { description: "none" };
      }
    }
  }

  return { description: "none" }; // fallback safeguard
}

async function scrapeWebsite(targetUrl, apiKey, postParams = {}) {
  try {
    if (!targetUrl) throw new Error("Target URL is required");
    if (!apiKey) throw new Error("ScrapingRobot API key is required");

    const response = await axios.post(
      `https://api.scrapingrobot.com/?token=${apiKey}`,
      {
        url: targetUrl,
        module: "HtmlRequestScraper",
        params: {
          contentType: "application/x-www-form-urlencoded",
        },
        postPayload: new URLSearchParams(postParams).toString(), // e.g. "param1=value1&param2=value2"
      },
      {
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
      }
    );

    console.log("ScrapingRobot response received");
    return response.data;
  } catch (error) {
    console.error("ScrapingRobot API error:", error.message);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    throw error;
  }
}

module.exports = { extractReply, extractBusinessDescription, scrapeWebsite };
