require("dotenv").config({ silent: true });

// services/emailParserService.js
async function extractReply({ emailContent, setErrorOccurred }) {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_SEC_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.evn.OPEN_ROUTER_MODEL,
        messages: [
          {
            role: "system",
            content: [
              "You are an assistant that extracts structured data from email threads.",
              "Given a raw email thread, separate it into five fields:",
              "- reply: only the prospect’s direct response (exclude signatures like 'Sent from my iPhone').",
              "- senderFirstName: the first name of the respondent who sent the reply.",
              "- senderLastName: the last name of the respondent who sent the reply.",
              "- original: the original quoted email content.",
              "- salesPerson: the full name of the salesperson who sent the original email.",
              "- salesPersonEmail: the email address of that salesperson.",
              "- signature: the email signature block of the reply.",
              "Always output valid JSON with keys: reply, original,senderFirstName,senderLastName, salesPerson, salesPersonEmail, signature.",
              "If any field is missing, return it as an empty string.",
            ].join(" "),
          },
          { role: "user", content: emailContent },
        ],
        temperature: 0,
      }),
    });

    const json = await resp.json();
    console.log(json)
    const modelOut = json.choices?.[0]?.message?.content?.trim();
    console.log("Raw model output:", modelOut);

    try {
      return JSON.parse(modelOut);
    } catch (parseErr) {
      console.error("Error parsing model output:", parseErr, "Raw:", modelOut);

      // 🔴 Mark error occurred
      // if (setErrorOccurred) setErrorOccurred(true);

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
  } catch (err) {
    console.error("Error calling OpenRouter:", err);

    // 🔴 Mark error occurred
    // if (setErrorOccurred) setErrorOccurred(true);

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
