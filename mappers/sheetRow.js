const { extractReply } = require("../services/emailParserService");
const { extractPhoneFromText, splitOnParagraphs } = require("../utils/regex");
const { colorize } = require("../utils/colorLogger");

async function mapToSheetRow(lead, email) {
  const payload = lead?.payload || {};
  const leadEmail = lead?.email || lead?.lead || email?.lead || "";
  const emailBodyText = email?.body?.text || "";
  const emailBodyHtml = email?.body?.html || "";

  // Use AI-powered extraction
  const extracted = await extractReply(emailBodyText || emailBodyHtml || "");

  const emailSignature = extracted.reply
    ? splitOnParagraphs(extracted.reply).slice(-2).join("\n\n")
    : "";

  const phoneFromEmail = extractPhoneFromText(extracted.reply);

  console.log(colorize("Extracted Email Content", "cyan"), extracted.reply);

  return {
    Agent: process.env.AGENT_NAME || "instaSheet agent",
    "For scheduling": "",
    "sales person": extracted.salesPerson || "",
    "sales person email": extracted.salesPersonEmail || "",
    company: lead?.company_name || lead?.company || "",
    "company phone#": lead?.phone || "",
    "phone#from email": phoneFromEmail,
    "lead first name": lead?.first_name || "",
    "lead last name": lead?.last_name || "",
    "lead email": leadEmail,
    "Column 1": leadEmail,
    "email reply": extracted.reply || "",
    "phone 1": lead?.phone || "",
    phone2: payload.phone2 || "",
    address: payload.address || lead?.address || "",
    city: payload.city || lead?.city || "",
    state: payload.state || lead?.state || "",
    zip: payload.zip || "",
    details: payload.details || lead?.details || lead?.website || "",
    "Email Signature": extracted.signature || emailSignature || "",
    _email_id: email?.id || email?.message_id || "",
    _lead_id: lead?.id || lead?.lead_id || "",
    _thread_id: email?.thread_id || "",
    _timestamp_email: email?.timestamp_email || email?.timestamp_created || "",
  };
}

module.exports = {
  mapToSheetRow,
};
