require("dotenv").config({ silent: true });



async function extractReply({ emailContent, setErrorOccurred, useLocal = false }) {
  try {
    // Fast-skip: empty content should not trigger LLM calls
    if (!emailContent || (typeof emailContent === "string" && emailContent.trim() === "")) {
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    const timeoutMs = Number(process.env.EMAIL_PARSER_TIMEOUT_MS || 60000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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

    console.log("extractReply - Using model: OPENROUTER_API_KEY ", model);

    // --- Construct system prompt ---
    const systemPrompt = [
      
      "OUTPUT SCHEMA (must match exactly):",
      `{
        "reply": "string"
      }`,
      "",
    ].join("\n");

    // --- Make API call ---
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: emailContent },
        ],
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Non-OK provider responses: soft-fail and continue
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.error("extractReply non-OK response:", response.status, errText);
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    const rawText = await response.text();
    console.log("extractReply received response");

    // --- Parse model response wrapper (OpenRouter / Local LLM) ---
    let modelOutput = "";
    try {
      const data = JSON.parse(rawText);
      // Accept direct JSON outputs that already match our schema
      if (data && typeof data === "object" && (
        Object.prototype.hasOwnProperty.call(data, "reply") ||
        (data.choices === undefined && data.message === undefined && data.output === undefined)
      )) {
        const direct = normalizeSchema(data);
        if (setErrorOccurred) setErrorOccurred(false);
        return direct;
      }
      // Try a variety of known shapes
      modelOutput = (
        (useLocal
          ? (data.message?.content || data.output)
          : (data.choices?.[0]?.message?.content || data.choices?.[0]?.text))
        || data.content
        || data.result
        || ""
      ).trim();
    } catch (err) {
      console.error("Error parsing top-level response:", err.message);
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    console.log("Raw model output:", modelOutput);

    // --- Clean and parse final JSON output ---
    let parsedJSON;
    try {
      const cleaned = modelOutput
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();

      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        if (setErrorOccurred) setErrorOccurred(false);
        return normalizeSchema({});
      }

      parsedJSON = JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.error("Error parsing JSON content:", err.message);
      if (setErrorOccurred) setErrorOccurred(false);
      return normalizeSchema({});
    }

    // --- Normalize schema ---
    const normalized = normalizeSchema(parsedJSON);

    if (setErrorOccurred) setErrorOccurred(false);
    return normalized;
  } catch (err) {
    console.error("Error calling LLM:", err.message);
    return errorResult(err.message, "", setErrorOccurred);
  }
}

// --- Helper: Standardize schema ---
function normalizeSchema(obj = {}) {
  return {
    reply: obj.reply || "",
    original: obj.original || "",
    senderFirstName: obj.senderFirstName || "",
    senderLastName: obj.senderLastName || "",
    salesPerson: obj.salesPerson || "",
    salesPersonEmail: obj.salesPersonEmail || "",
    signature: obj.signature || "",
  };
}

// --- Helper: Error response builder ---
function errorResult(message, raw, setErrorOccurred) {
  if (setErrorOccurred) setErrorOccurred(true);
  return {
    reply: "",
    original: "",
    senderFirstName: "",
    senderLastName: "",
    salesPerson: "",
    salesPersonEmail: "",
    signature: "",
    error: message,
    raw,
  };
}

module.exports = { extractReply };
