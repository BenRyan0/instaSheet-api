require("dotenv").config({ silent: true });

// services/emailParserService.js
async function extractReply({
  emailContent,
  setErrorOccurred,
  useLocal = true,
}) {
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

    console.log("extractReply");
    console.log(headers);
    console.log(model);
    console.log("extractReply");

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: [
              // 1. Clear Instructions
              "You are an expert email parsing and extraction system. Your task is to analyze the provided email thread and extract specific pieces of information. The most crucial part of this task is to return **only a valid JSON object**. It must **not include** any surrounding text, explanations, or **markdown code blocks** (like ```json).",

              // 2. Field Definitions
              "Extract the following fields from the email thread:",
              "- **reply**: The most recent, main reply or body of the latest email in the thread, excluding previous quoted emails, signatures, and automatic footers.",
              "- **senderFirstName**: The first name of the person who wrote the most recent reply.",
              "- **senderLastName**: The last name of the person who wrote the most recent reply.",
              "- **original**: The full, complete, raw content of the entire email thread as provided in the input.",
              "- **salesPerson**: The full name of the internal sales representative or account manager mentioned in the email thread, if any. Use an empty string if not found.",
              "- **salesPersonEmail**: The email address of the sales representative or account manager mentioned, if any. Use an empty string if not found.",
              "- **signature**: The full text of the sender's email signature (e.g., name, title, company, phone number).",

              // 3. Output Format and Constraint
              'If a field\'s value cannot be definitively extracted, its value must be an **empty string (`""`)**, not `null`.',

              // 4. Schema Reinforcement (The output format you MUST use)
              "Your final output MUST be a valid JSON object matching this structure, and **nothing else**:",
              `{
                "reply": "string",
                "senderFirstName": "string",
                "senderLastName": "string",
                "original": "string",
                "salesPerson": "string",
                "salesPersonEmail": "string",
                "signature": "string"
              }`,
            ].join("\n"),
          },
          { role: "user", content: emailContent },
        ],
        temperature: 0,
        stream: false, // 🚨 avoids NDJSON streaming
      }),
    });

    const rawText = await resp.text();
    console.log("Raw response text:", rawText);

    let json;
    try {
      json = JSON.parse(rawText);
    } catch (err) {
      console.error("Failed to parse API response as JSON:", err.message);
      if (setErrorOccurred) setErrorOccurred(true);
      return {
        reply: "",
        original: "",
        senderFirstName: "",
        senderLastName: "",
        salesPerson: "",
        salesPersonEmail: "",
        signature: "",
        raw: rawText,
        error: err.message,
      };
    }

    const modelOut = useLocal
      ? json.message?.content?.trim() || json.output?.trim() || ""
      : json.choices?.[0]?.message?.content?.trim() ||
        json.choices?.[0]?.text?.trim() ||
        "";

    console.log("Raw model output:", modelOut);

    let parsed;
    try {
      // 🧹 Clean model output
      let cleaned = modelOut.trim();
      cleaned = cleaned
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];

      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(
        "Error parsing model output:",
        parseErr.message,
        "Raw:",
        modelOut
      );
      if (setErrorOccurred) setErrorOccurred(true);
      return {
        reply: "",
        original: "",
        senderFirstName: "",
        senderLastName: "",
        salesPerson: "",
        salesPersonEmail: "",
        signature: "",
        raw: modelOut,
        error: parseErr.message,
      };
    }

    // ✅ Normalize schema
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
    console.error("Error calling LLM:", err);
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
