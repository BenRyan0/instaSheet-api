require("dotenv").config({ silent: true });

function cleanEmailContent(rawEmail) {
  let cleaned = rawEmail
    // Keep header but remove forwarded separators
    .replace(/-{2,}Original Message-{2,}/gi, '')
    // Remove older quoted messages (e.g. "On Thu, ... wrote:")
    // Remove common signature closings
    .replace(/(With appreciation,|All the best,|Sincerely,|Regards,)\s*[\s\S]*$/gi, '')
    // Collapse multiple newlines into a single space
    .replace(/\n+/g, ' ')
      // Remove quote markers like ">", "> >", "> > >"
    .replace(/(^|\n)\s*>+\s?/g, '$1')
    // Remove multiple spaces
    .replace(/\s{2,}/g, ' ')
    // Trim leading/trailing spaces
    .trim();

  return cleaned;
}


async function extractReply({ emailContent,content_preview, setErrorOccurred }) {
  try {
    console.log("emailContent")
    console.log(emailContent)
    // Clean the incoming email text
    const cleanedContent = cleanEmailContent(emailContent);

    console.log("cleanedContent")
    console.log(cleanedContent)
    // Skip if empty after cleaning
    if (!cleanedContent) {
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    const response = await fetch("http://localhost:5678/webhook/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailContent: cleanedContent, content_preview: content_preview }),
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
    return normalizeSchema({});
  }
}

/**
 * Normalizes output structure
 */
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
