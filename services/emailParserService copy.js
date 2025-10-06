require("dotenv").config({ silent: true });

// services/emailParserService.js
// Pure-JS parser from before
function parseEmailThread(rawText) {
  const normalized = rawText.replace(/\n{3,}/g, "\n\n").trim();
  const threadRegex = /^---- On [\s\S]+? wrote ---$/m;
  const [head, quoteAndBelow] = normalized.split(threadRegex);
  const original = quoteAndBelow ? quoteAndBelow.trim() : "";

  const headerMatch = rawText.match(
    /^---- On [^<]+? ([^<]+) <([^>]+)> wrote ---$/m
  );
  const salesPerson = headerMatch ? headerMatch[1].trim() : "";
  const salesPersonEmail = headerMatch ? headerMatch[2].trim() : "";

  const sigStart = head.search(/\n(?:Thanks(?: & Regards)?|Best|Cheers)/i);
  const sigBlock = sigStart > 0 ? head.slice(sigStart).trim() : "";
  const signature = Array.from(new Set(sigBlock.split("\n")))
    .join("\n")
    .trim();

  const reply = sigStart > 0 ? head.slice(0, sigStart).trim() : head.trim();

  const nameMatch = signature.match(/^([\w'-]+)\s+([\w'-]+)/m);
  const senderFirstName = nameMatch ? nameMatch[1] : "";
  const senderLastName = nameMatch ? nameMatch[2] : "";

  return {
    reply,
    original,
    senderFirstName,
    senderLastName,
    salesPerson,
    salesPersonEmail,
    signature,
  };
}

// Main extractor with LLM fallback
async function extractReply({
  emailContent,
  setErrorOccurred,
  useLocal = false,
}) {
  // 1. Attempt deterministic parse first
  const fallback = parseEmailThread(emailContent);
  console.log(fallback);
  console.log("fallback");
  if (fallback.reply || fallback.original || fallback.signature) {
    if (setErrorOccurred) setErrorOccurred(false);
    return fallback;
  }

  // 2. Fallback to LLM if no reply found
  try {
    const url = useLocal
      ? "http://localhost:11434/api/chat"
      : "https://openrouter.ai/api/v1/chat/completions";

    const headers = useLocal
      ? { "Content-Type": "application/json" }
      : {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        };

    const model = useLocal
      ? process.env.LOCAL_LLM
      : process.env.OPEN_ROUTER_MODEL;

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are an expert email parsing and extraction system.",
              "Your job is to analyze the provided raw email thread and return a single JSON object with precise fields.",
              "",
              "General Rules:",
              "- You MUST only output a valid JSON object — no markdown, comments, or text before/after it.",
              "- Do NOT include ```json or any formatting indicators.",
              "- Each field must be a plain string (never null). If not found, return an empty string ('').",
              "",
              "Definition of key fields:",
              "- reply: The main written message from the most recent sender. Exclude any quoted messages, automatic disclaimers, or signatures.",
              "- senderFirstName: The first name of the person who wrote the most recent reply. Use the sender's **own name**, typically found before the signature or in the email header section (e.g., 'Best, John Doe' → John). If no full name is visible, extract the given name from the sender's line (e.g., 'From: Sarah L. Connor <sarah@company.com>' → Sarah).",
              "- senderLastName: The last name of that same person (e.g., 'John Doe' → Doe).",
              "- original: The full raw email thread content as provided.",
              "- salesPerson: The full name of any sales or account manager mentioned in the email (if multiple, choose the one directly associated with the thread). Otherwise empty.",
              "- salesPersonEmail: The email address of the sales representative if mentioned; otherwise empty.",
              "- signature: The sender’s signature block (the text typically after a sign-off like 'Best regards,' or 'Thanks,').",
              "",
              "Output Schema (must match exactly):",
              `{
                "reply": "string",
                "senderFirstName": "string",
                "senderLastName": "string",
                "original": "string",
                "salesPerson": "string",
                "salesPersonEmail": "string",
                "signature": "string"
              }`,
              "",
              "Focus especially on correctly identifying the sender's first and last name. Never confuse them with the recipient, sales rep, or quoted senders in older messages.",
            ].join("\n"),
          },
          { role: "user", content: emailContent },
        ],
        temperature: 0,
        stream: false,
      }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const rawText = await resp.text();
    let json = JSON.parse(rawText);

    const modelOut = useLocal
      ? json.message?.content?.trim() || json.output?.trim() || ""
      : json.choices?.[0]?.message?.content?.trim() ||
        json.choices?.[0]?.text?.trim() ||
        "";

    // Clean and parse LLM JSON
    let cleaned = modelOut
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];
    const parsed = JSON.parse(cleaned);

    // Schema normalizer
    const ensureSchema = (obj) => ({
      reply: obj.reply || "",
      original: obj.original || "",
      senderFirstName: obj.senderFirstName || "",
      senderLastName: obj.senderLastName || "",
      salesPerson: obj.salesPerson || "",
      salesPersonEmail: obj.salesPersonEmail || "",
      signature: obj.signature || "",
    });

    if (setErrorOccurred) setErrorOccurred(false);
    return ensureSchema(parsed);
  } catch (err) {
    console.error("extractReply error:", err);
    if (setErrorOccurred) setErrorOccurred(true);
    return {
      reply: "",
      original: "",
      senderFirstName: "",
      senderLastName: "",
      salesPerson: "",
      salesPersonEmail: "",
      signature: "",
      error: err.message,
    };
  }
}

module.exports = {
  extractReply,
};
