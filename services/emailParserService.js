require("dotenv").config({ silent: true });
const axios = require("axios");
const cheerio = require('cheerio');

function cleanEmailContent(rawEmail, maxWords = 100) {
  let cleaned = rawEmail
    // Keep header but remove forwarded separators
    // .replace(/-{2,}Original Message-{2,}/gi, '')
    // Remove email separators made of underscores or dashes
    .replace(/_{5,}|-{5,}/g, "")
    // Remove quote markers like ">", "> >", "> > >"
    .replace(/(^|\n)\s*>+\s?/g, "$1")
    // Remove hyperlinks inside angle brackets <https://...> or <mailto:...>
    .replace(/<https?:\/\/[^>]+>/gi, "")
    .replace(/<mailto:[^>]+>/gi, "")
    // Remove inline URLs like http://example.com or https://domain.biz
    .replace(/https?:\/\/\S+/gi, "")
    // Collapse multiple newlines into a single space
    .replace(/\n+/g, " ")
    // Remove multiple spaces
    .replace(/\s{2,}/g, " ")
    // Trim leading/trailing spaces
    .trim();

  // --- limit total words ---
  const words = cleaned.split(/\s+/);
  if (words.length > maxWords) {
    cleaned = words.slice(0, maxWords).join(" ") + "...";
  }

  return cleaned;
}

async function extractReply({
  emailContent,
  content_preview,
  setErrorOccurred,
  setErrorContext,
}) {
  try {
    console.log("emailContent");
    console.log(emailContent);

    // Check if email content has fewer than 20 words — skip cleaning if so
    const wordCount = emailContent?.trim().split(/\s+/).length || 0;
    let cleanedContent = emailContent;

    if (wordCount >= 20) {
      cleanedContent = cleanEmailContent(emailContent, 100);
      console.log("cleanedContent");
      console.log(cleanedContent);
    } else {
      console.log(
        `Skipping cleanEmailContent — only ${wordCount} words detected.`
      );
    }

    // Skip if empty after cleaning
    if (!cleanedContent) {
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    console.log("cleanEmailContent")
    console.log(cleanEmailContent)

    const response = await fetch("http://localhost:5678/webhook/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailContent: cleanedContent,
        content_preview: content_preview,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("extractReply non-OK response:", response.status, errText);
      if (setErrorOccurred) setErrorOccurred(true);
      return normalizeSchema({});
    }

    const data = await response.json().catch(() => ({}));
    const reply = data.reply || "";

    if (setErrorOccurred) setErrorOccurred(false);
    return normalizeSchema({ reply });
  } catch (err) {
    console.error("Error calling webhook:", err.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(err.message);
    return normalizeSchema({});
  }
}

// async function extractBusinessDescription({
//   websiteUrl,
//   serpApiKey = process.env.SERPAPI_KEY,
//   setErrorOccurred,
//   setErrorContext,
// }) {
//   try {
//     if (!websiteUrl) throw new Error("Website URL is required");
//     if (!serpApiKey) throw new Error("SerpApi API key missing");

//     const serpApiUrl = "https://serpapi.com/search.json";
//     const query = `site:${websiteUrl}`;

//     const { data } = await axios.get(serpApiUrl, {
//       params: { q: query, api_key: serpApiKey, num: 1, hl: "en" },
//       timeout: 60000,
//     });

//     const description =
//       data?.knowledge_graph?.description ||
//       data?.organic_results?.[0]?.snippet ||
//       data?.organic_results?.[0]?.rich_snippet?.top?.extensions?.join(" ") ||
//       "none";

//     setErrorOccurred?.(false);
//     return { description };
//   } catch (err) {
//     const status = err.response?.status;
//     const message =
//       err.response?.data?.error ||
//       err.message ||
//       "Unknown error contacting SerpApi.";

//     if (status === 503) {
//       console.warn("SerpApi temporarily unavailable. Retrying in 3s...");
//       await new Promise((res) => setTimeout(res, 3000));

//       // Optional retry once
//       return extractBusinessDescription({
//         websiteUrl,
//         serpApiKey,
//         setErrorOccurred,
//         setErrorContext,
//       });
//     }

//     setErrorOccurred?.(true);
//     setErrorContext?.(message);
//     return { description: "none" };
//   }
// }
async function extractBusinessDescription({
  websiteUrl,
  serpApiKey = process.env.SERPAPI_KEY,
  setErrorOccurred,
  setErrorContext,
}) {
  if (!websiteUrl) throw new Error("Website URL is required");
  if (!serpApiKey) throw new Error("SerpApi API key missing");

  const serpApiUrl = "https://serpapi.com/search.json";
  const query = `site:${websiteUrl}`;
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
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
      attempt++;
      const status = err.response?.status;
      const message =
        err.response?.data?.error ||
        err.message ||
        "Unknown error contacting SerpApi.";

      if (status === 503 && attempt < maxRetries) {
        console.warn(
          `SerpApi unavailable (attempt ${attempt}/${maxRetries}). Retrying in 3s...`
        );
        await new Promise((res) => setTimeout(res, 3000));
        continue;
      }

      if (attempt >= maxRetries) {
        console.error(
          `extractBusinessDescription failed after ${maxRetries} attempts: ${message}`
        );
        setErrorOccurred?.(true);
        setErrorContext?.(message);
        return { description: "none" };
      }
    }
  }

  // Fallback safeguard (should never reach here)
  return { description: "none" };
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

    console.log("✅ ScrapingRobot response received");
    return response.data;
  } catch (error) {
    console.error("❌ ScrapingRobot API error:", error.message);
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

module.exports = { extractReply,extractBusinessDescription ,scrapeWebsite};
