// mapToSheetRow.js
const { extractReply } = require("../services/emailParserService");
const { extractPhoneFromText, splitOnParagraphs } = require("../utils/regex");
const { colorize } = require("../utils/colorLogger");
const env = require("../env");

// Helper: Check if email body is valid
// function validateEmailBody(emailBodyText) {
//   if (!emailBodyText || typeof emailBodyText !== "string" || !emailBodyText.trim()) {
//     throw new Error("Empty email content; skipping extraction");
//   }

//   const wordCount = emailBodyText.trim().split(/\s+/).filter(Boolean).length;
//   if (wordCount > 500) {
//     throw new Error("Email body exceeds 500 words; skipping extraction");
//   }
// }
// Helper: Check if email body is valid
function validateEmailBody(emailBodyText) {
  if (
    !emailBodyText ||
    typeof emailBodyText !== "string" ||
    !emailBodyText.trim()
  ) {
    throw new Error("Empty email content; skipping extraction");
  }

  const words = emailBodyText.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount > 500) {
    console.warn(
      `[validateEmailBody] Email body exceeds 500 words (${wordCount}). Using first 100 words instead.`
    );
    return words.slice(0, 100).join(" ");
  }

  return emailBodyText.trim();
}

// Helper: Extract names from various possible sources
function parseName(lead, email) {
  const payload = lead?.payload || {};
  let firstName = lead?.first_name || "";
  let lastName = lead?.last_name || "";

  // Try from payload.user_name
  if ((!firstName || !lastName) && payload.user_name) {
    const parts = payload.user_name.trim().split(/\s+/);
    firstName ||= parts[0] || "";
    lastName ||= parts.slice(1).join(" ") || "";
  }

  // Try from email.from_address_json
  if ((!firstName || !lastName) && Array.isArray(email?.from_address_json)) {
    const fromName = email.from_address_json[0]?.name || "";
    if (fromName) {
      const parts = fromName.trim().split(/\s+/);
      firstName ||= parts[0] || "";
      lastName ||= parts.slice(1).join(" ") || "";
    }
  }

  return { firstName, lastName };
}

// Helper: Extract phones from payload and lead
function extractPhones(lead) {
  const payload = lead?.payload || {};
  let rawPhones =
    lead?.phone || payload.phone || payload.phone1 || payload.phone2 || "";

  let phone1 = "";
  let phone2 = "";

  if (rawPhones) {
    const parts = rawPhones.split(",").map((p) => p.trim());
    phone1 = parts[0] || "";
    phone2 = parts[1] || "";
  }

  // Fallbacks
  if (!phone1) phone1 = payload.phone1 || "";
  if (!phone2) phone2 = payload.phone2 || "";

  return { phone1, phone2 };
}

// Helper: Extract salesperson info from email
function extractSalesPerson(email) {
  if (
    Array.isArray(email?.to_address_json) &&
    email.to_address_json.length > 0
  ) {
    const toAddr = email.to_address_json[0];
    return {
      salesPerson: toAddr.name || "none",
      salesPersonEmail: toAddr.address || "none",
    };
  }
  return { salesPerson: "none", salesPersonEmail: "none" };
}

// Helper: Construct final sheet row
function buildSheetRow({
  extracted,
  lead,
  email,
  firstName,
  lastName,
  phone1,
  phone2,
  salesPerson,
  salesPersonEmail,
}) {
  const payload = lead?.payload || {};
  const leadEmail = lead?.email || lead?.lead || email?.lead || "";
  const phoneFromEmail = extractPhoneFromText(extracted.reply);
  const emailSignature = extracted.signature || "";

  return {
    "Column 1": env.AGENT_NAME || "instaSheet agent x1",
    "For scheduling": "none",
    "sales person": salesPerson || "none",
    "sales person email": salesPersonEmail || "none",
    company: lead?.company_name || lead?.company || "none",
    "company phone#": lead?.phone || "none",
    "phone#from email": phoneFromEmail || "none",
    "lead first name": firstName || "none",
    "lead last name": lastName || "none",
    "lead email": leadEmail || "none",
    "Column 2": leadEmail || "none",
    "email reply": extracted.reply || "",
    "phone 1": phone1 || "none",
    "#": phone1 || "none",
    phone2: phone2 || "none",
    address: payload.street || payload.address || lead?.address || "none",
    city: payload.city || lead?.city || "none",
    state: payload.state || lead?.state || payload.organization_state || "none",
    zip:
      payload.zip ||
      payload.zip_code ||
      payload.organization_postal_code ||
      "none",
    details: payload.details || lead?.details || lead?.website || "none",
    "Email Signature": emailSignature || "none",
    "linkedin link": "none",
    "status after the call": "none",
  };
}

// Main function
async function mapToSheetRow({
  lead,
  email,
  setErrorOccurred,
  setErrorContext,
}) {
  try {
    console.log(colorize("LEAD", "cyan"), lead);
    console.log(colorize("EMAIL", "cyan"), email);
    const emailBodyText = email?.body?.text || "";

    // Step 1: Validate email body
    const validEmailBody = validateEmailBody(emailBodyText);

    // Step 2: Extract reply using AI
    const extracted = await extractReply({
      emailContent: validEmailBody,
      content_preview: email.content_preview || "",
      setErrorOccurred,
      setErrorContext,
    });

    console.log(colorize("Extracted Email Content", "cyan"), extracted.reply);

    // Step 3: Extract structured info
    const { firstName, lastName } = parseName(lead, email);
    const { phone1, phone2 } = extractPhones(lead);
    const { salesPerson, salesPersonEmail } = extractSalesPerson(email);

    // Step 4: Build final row
    return buildSheetRow({
      extracted,
      lead,
      email,
      firstName,
      lastName,
      phone1,
      phone2,
      salesPerson,
      salesPersonEmail,
    });
  } catch (error) {
    console.error(
      `mapToSheetRow error (${lead?.email || "unknown lead"}):`,
      error.message
    );
    setErrorOccurred(true);
    setErrorContext(`mapToSheetRow: ${error.message}`);
    return null;
  }
}

module.exports = { mapToSheetRow };
