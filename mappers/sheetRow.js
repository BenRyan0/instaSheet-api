const { extractReply } = require("../services/emailParserService");
const { extractPhoneFromText, splitOnParagraphs } = require("../utils/regex");
const { colorize } = require("../utils/colorLogger");
require("dotenv").config({ quiet: true });

async function mapToSheetRow({
  lead,
  email,
  setErrorOccurred,
  setErrorContext
}) {
  const payload = lead?.payload || {};
  const leadEmail = lead?.email || lead?.lead || email?.lead || "";
  const emailBodyText = email?.body?.text || "";

  // console.log("mapToSheetRow");
  console.log("mapToSheetRow -lead");
  console.log(lead);
  console.log("mapToSheetRow -email");
  console.log(email);

  // If there is no email content, skip extraction entirely
  if (
    !emailBodyText ||
    (typeof emailBodyText === "string" && emailBodyText.trim() === "")
  ) {
    throw new Error("Empty email content; skipping extraction");
  }

  // If email body exceeds 500 words, skip this lead's email without attempting extraction
  const wordCount =
    typeof emailBodyText === "string"
      ? emailBodyText.trim().split(/\s+/).filter(Boolean).length
      : 0;
  if (wordCount > 500) {
    console.log("Email body exceeds 500 words; skipping extraction");
    throw new Error("Email body exceeds 500 words; skipping extraction");
  }

  // Use AI-powered extraction
  const extracted = await extractReply({
    emailContent: emailBodyText || "",
    content_preview: email.content_preview || "",
    setErrorOccurred,
    setErrorContext,
  });
  // console.log("extracted -LLM");
  // console.log(extracted);

  // split user_name into firstname/lastname
  let firstName = lead?.first_name || "";
  let lastName = lead?.last_name || "";

  if ((!firstName || !lastName) && payload.user_name) {
    const parts = payload.user_name.trim().split(/\s+/);
    firstName = firstName || parts[0] || "";
    lastName = lastName || parts[1] || "";
  }

  // If still missing, try from from_address_json
  if (
    (!firstName || !lastName) &&
    Array.isArray(email?.from_address_json) &&
    email.from_address_json.length > 0
  ) {
    const fromName = email.from_address_json[0].name || "";
    if (fromName) {
      const parts = fromName.trim().split(/\s+/);
      firstName = firstName || parts[0] || "";
      lastName = lastName || parts.slice(1).join(" ") || ""; // everything after first word
    }
  }
  // Handle phone splitting (lead.phone or payload.phone can contain multiple)
  let phone1 = "";
  let phone2 = "";

  const rawPhones =
    lead?.phone || payload.phone || payload.phone1 || payload.phone2 || "";
  if (rawPhones) {
    const parts = rawPhones.split(",").map((p) => p.trim());
    phone1 = parts[0] || "";
    phone2 = parts[1] || "";
  }

  // fallback if payload.phone1/phone2 exist as separate fields
  if (!phone1) phone1 = payload.phone1 || "";
  if (!phone2) phone2 = payload.phone2 || "";

  let salesPerson = "";
  let salesPersonEmail = "";

  // Use lead.to_address_json if available
  if (
    Array.isArray(email?.to_address_json) &&
    email.to_address_json.length > 0
  ) {
    const toAddr = email.to_address_json[0];
    salesPerson = toAddr.name || "";
    salesPersonEmail = toAddr.address || "";
  }

  const emailSignature = extracted.reply
    ? splitOnParagraphs(extracted.reply).slice(-2).join("\n\n")
    : "";

  const phoneFromEmail = extractPhoneFromText(extracted.reply);

  console.log(colorize("Extracted Email Content", "cyan"), extracted.reply);

  return {
    "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
    "For scheduling": "none",
    "sales person": salesPerson || "none",
    "sales person email": salesPersonEmail || "none",
    company: lead?.company_name || lead?.company || "none",
    "company phone#": lead?.phone || "none",
    "phone#from email": phoneFromEmail || "none",
    "lead first name": firstName || "none",
    "lead last name": lastName || "none",
    "lead email": leadEmail,
    "Column 2": leadEmail,
    "email reply": extracted.reply || "none",
    "phone 1": phone1,
    "#": phone1, // keeping same as phone 1
    phone2: phone2,
    address: lead?.payload?.street || payload.address || lead?.address || "none",
    city: payload?.city || lead?.city || "none",
    state: payload?.state || lead?.state || payload?.organization_state || "none",
    zip: payload?.zip || payload?.zip_code || payload?.organization_postal_code || "none",
    details: payload?.details || lead?.details || lead?.website || "none",
    "Email Signature": "none",
    // "Email Signature": extracted.signature || emailSignature || "",
    "linkedin link": "none",
    "status after the call": "none",
  };
}

module.exports = {
  mapToSheetRow,
};
