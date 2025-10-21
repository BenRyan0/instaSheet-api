require("dotenv").config({ silent: true });

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

module.exports = { extractReply };
