const env = require("../env");
const axios = require("axios");
const { colorize } = require("../utils/colorLogger");


function cleanEmailContent(rawEmail, maxWords = 100) {
  if (!rawEmail || typeof rawEmail !== "string") return "";
  // Remove everything starting from the first '>' line (and onward)
  let cleaned = rawEmail.split(/\n>/)[0];
  // Remove HTML tags if any
  cleaned = cleaned.replace(/<[^>]*>/g, "")
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
    const response = await fetch(url, { ...options, signal: controller.signal });
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
    console.log(colorize("EmailContent", "cyan"), emailContent);

    const wordCount = emailContent?.trim().split(/\s+/).length || 0;
    let cleanedContent = emailContent;

    if (wordCount >= 20) {
      cleanedContent = cleanEmailContent(emailContent, 100);
      console.log(colorize("CleanedContent", "cyan"), cleanedContent);
    } else {
      console.log(`Skipping cleanEmailContent — only ${wordCount} words detected.`);
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

    // --- Send to OpenRouter ---
    const prompt = `
            You are an email parsing assistant.

            Task: Extract the **latest human reply** from an email thread.

            Rules:
            1. Find where this content preview first appears: "${content_preview}" (case-insensitive).
            2. Collect all text until a line that matches any of these patterns:
              ^On\\s, ^From:, ^Sent:, ^To:, ^Subject:, wrote:, Forwarded message,
              Begin forwarded message, -----Original Message-----
            3. If such a marker appears on the same line, cut before it.
            4. Remove:
              - Lines starting with ">"
              - Signatures starting with "--", "Thanks,", "Best,", "Regards,"
              - URLs, emails, phone numbers
              - Extra blank lines
            Output only a JSON object:
            { "reply": "cleaned_reply_text" }
            If nothing valid remains, output:
            { "reply": "" }
            `;

    const body = JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: cleanedContent },
      ],
      temperature: 0,
    });

    const resp = await fetchWithTimeout(url, { method: "POST", headers, body }, 60000);

    console.log("OpenRouter response status:", resp.status);

    if (!resp.ok) {
      console.error("OpenRouter Error:", resp.status);
      if (resp.status === 429 && keyIndex < apiKeys.length - 1) {
        const delay = 2000 * (keyIndex + 1);
        console.warn(`Rate limited on key #${keyIndex + 1}. Retrying in ${delay / 1000}s...`);
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
    const replyRaw =
      json.choices?.[0]?.message?.content?.trim() ||
      json.choices?.[0]?.text?.trim() ||
      "";

    let parsedReply;
    try {
      parsedReply = JSON.parse(replyRaw);
    } catch {
      parsedReply = { reply: replyRaw };
    }

    if (setErrorOccurred) setErrorOccurred(false);
    return normalizeSchema({ reply: parsedReply.reply || "" });
  } catch (err) {
    console.error("Error calling OpenRouter:", err.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(err.message);
    return normalizeSchema({});
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

  const serpApiUrl = "https://serpapi.com/search.json";
  const normalizedUrl = websiteUrl.replace(/^https?:\/\//, "").split("/")[0];
  const query = `site:${normalizedUrl}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { data } = await axios.get(serpApiUrl, {
        params: { q: query, api_key: serpApiKey, num: 1, hl: "en" },
        timeout: 60000,
      });

      const description =
        data?.knowledge_graph?.description ||
        data?.organic_results?.[0]?.snippet ||
        data?.organic_results?.[0]?.rich_snippet?.top?.extensions?.join(" ") ||
        "none";

      setErrorOccurred?.(false);
      return { description };
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

function normalizeSchema(obj = {}) {
  return {
    reply: obj.reply || "",
    senderFirstName: "",
    senderLastName: "",
    original: "",
    salesPerson: "",
    salesPersonEmail: "",
    signature: "",
  };
}

module.exports = { extractReply, extractBusinessDescription, scrapeWebsite };
