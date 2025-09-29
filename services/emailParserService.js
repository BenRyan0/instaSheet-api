require("dotenv").config({ silent: true });

// services/emailParserService.js
async function extractReply(emailContent) {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_SEC_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "x-ai/grok-4-fast:free",
        messages: [
          {
            role: "system",
            content: [
              "You are an assistant that extracts structured data from email threads.",
              "Given a raw email thread, separate it into five fields:",
              "- reply: only the prospect’s direct response (exclude signatures like 'Sent from my iPhone').",
              "- original: the original quoted email content.",
              "- salesPerson: the full name of the salesperson who sent the original email.",
              "- salesPersonEmail: the email address of that salesperson.",
              "- signature: the email signature block of the reply (e.g., name, title, company, phone, address, email).",
              "Always output valid JSON with keys: reply, original, salesPerson, salesPersonEmail, signature.",
              "If any field is missing, return it as an empty string.",
            ].join(" "),
          },
          { role: "user", content: emailContent },
        ],
        temperature: 0,
      }),
    });

    const json = await resp.json();
    const modelOut = json.choices?.[0]?.message?.content?.trim();
    console.log("Raw model output:", modelOut);

    try {
      return JSON.parse(modelOut);
    } catch {
      return {
        reply: "",
        original: "",
        salesPerson: "",
        salesPersonEmail: "",
        signature: "",
        raw: modelOut,
      };
    }
  } catch (err) {
    console.error("Error calling OpenRouter:", err);
    return {
      reply: "",
      original: "",
      salesPerson: "",
      salesPersonEmail: "",
      signature: "",
      error: err.message,
    };
  }
}



  // extractReply = async (emailContent) => {
  //   try {
  //     const resp = await fetch(
  //       "https://openrouter.ai/api/v1/chat/completions",
  //       {
  //         method: "POST",
  //         headers: {
  //           Authorization: `Bearer ${process.env.OPENROUTER_API_SEC_KEY}`,
  //           "Content-Type": "application/json",
  //         },
  //         body: JSON.stringify({
  //           model: "x-ai/grok-4-fast:free",
  //           messages: [
  //             {
  //               role: "system",
  //               content: [
  //                 "You are an assistant that extracts structured data from email threads.",
  //                 "Given a raw email thread, separate it into four fields:",
  //                 "- reply: only the prospect’s direct response (remove signatures like 'Sent from my iPhone').",
  //                 "- original: the original quoted email content.",
  //                 "- salesPerson: the full name of the salesperson who sent the original email.",
  //                 "- salesPersonEmail: the email address of that salesperson.",
  //                 "Always output valid JSON with keys: reply, original, salesPerson, salesPersonEmail.",
  //                 "If any field is missing, return it as an empty string.",
  //               ].join(" "),
  //             },
  //             { role: "user", content: emailContent },
  //           ],
  //           temperature: 0,
  //         }),
  //       }
  //     );

  //     const json = await resp.json();
  //     const modelOut = json.choices?.[0]?.message?.content?.trim();

  //     try {
  //       return JSON.parse(modelOut);
  //     } catch {
  //       return {
  //         reply: "",
  //         original: "",
  //         salesPerson: "",
  //         salesPersonEmail: "",
  //         raw: modelOut,
  //       };
  //     }
  //   } catch (err) {
  //     console.error("Error calling OpenRouter:", err);
  //     return {
  //       reply: "",
  //       original: "",
  //       salesPerson: "",
  //       salesPersonEmail: "",
  //       error: err.message,
  //     };
  //   }
  // };

  
module.exports = { extractReply };
