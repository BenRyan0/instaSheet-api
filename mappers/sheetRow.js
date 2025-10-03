require("dotenv").config();
const { extractReply } = require("../services/emailParserService");
const { extractPhoneFromText, splitOnParagraphs } = require("../utils/regex");
const { colorize } = require("../utils/colorLogger");

// async function mapToSheetRow(lead, email) {
//   console.log("LEAD AND EMAIL START")
//   console.log(lead)
//   console.log(email)
//   console.log("LEAD AND EMAIL")

//   const payload = lead?.payload || {};
//   const leadEmail = lead?.email || lead?.lead || email?.lead || "";
//   const emailBodyText = email?.body?.text || "";
//   const emailBodyHtml = email?.body?.html || "";

//    // split user_name into firstname/lastname
//   let firstName = lead?.first_name || "";
//   let lastName = lead?.last_name || "";

//   if ((!firstName || !lastName) && payload.user_name) {
//     const parts = payload.user_name.trim().split(/\s+/);
//     firstName = firstName || parts[0] || "";
//     lastName = lastName || parts[1] || "";
//   }

//   // Use AI-powered extraction
//   const extracted = await extractReply(emailBodyText || emailBodyHtml || "");

//   const emailSignature = extracted.reply
//     ? splitOnParagraphs(extracted.reply).slice(-2).join("\n\n")
//     : "";

//   const phoneFromEmail = extractPhoneFromText(extracted.reply);

//   console.log(colorize("Extracted Email Content", "cyan"), extracted.reply);

//   return {
//     "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
//     "For scheduling": "",
//     "sales person": extracted.salesPerson || "",
//     "sales person email": extracted.salesPersonEmail || "",
//     company: lead?.company_name || lead?.company || "",
//     "company phone#": lead?.phone || "none",
//     "phone#from email": phoneFromEmail || "none",
//      "lead first name": firstName,
//     "lead last name": lastName,
//     // "lead first name": lead?.first_name || lead?.payload?.user_name || "",
//     // "lead last name": lead?.last_name || lead?.payload?.user_name || "",

//     "lead email": leadEmail,
//     "Column 2": leadEmail,
//     "email reply": extracted.reply || "",
//     "phone 1":payload.phone || payload.phone1 ||lead?.phone || "",
//     "#": lead?.phone || "",
//     phone2: payload.phone2 || payload.phone2 ||lead?.phone2 || "",
//     address: payload.address || lead?.address || "",
//     city: payload.city || lead?.city || "",
//     state: payload.state || lead?.state || "",
//     zip: payload.zip || payload.zip_code || "",
//     details: payload.details || lead?.details || lead?.website || "",
//     "Email Signature": extracted.signature || emailSignature || "",
//     "linkedin link": "none",
//     "2nd contact person linked": "none",
//     "status after the call": "none",
//     "number of calls spoken with the leads": "",
//     "@dropdown": "",
//     // _email_id: email?.id || email?.message_id || "",
//     // _lead_id: lead?.id || lead?.lead_id || "",
//     // _thread_id: email?.thread_id || "",
//     // _timestamp_email: email?.timestamp_email || email?.timestamp_created || "",
//   };
// }

async function mapToSheetRow(lead, email) {
  // console.log("LEAD AND EMAIL START");
  // console.log(lead);
  // console.log(email);
  // console.log("LEAD AND EMAIL");

  const payload = lead?.payload || {};
  const leadEmail = lead?.email || lead?.lead || email?.lead || "";
  const emailBodyText = email?.body?.text || "";
  const emailBodyHtml = email?.body?.html || "";

  // split user_name into firstname/lastname
  let firstName = lead?.first_name || "";
  let lastName = lead?.last_name || "";

  if ((!firstName || !lastName) && payload.user_name) {
    const parts = payload.user_name.trim().split(/\s+/);
    firstName = firstName || parts[0] || "";
    lastName = lastName || parts[1] || "";
  }

  // ✅ If still missing, try from from_address_json
  if (
    (!firstName || !lastName) &&
    Array.isArray(lead?.from_address_json) &&
    lead.from_address_json.length > 0
  ) {
    const fromName = lead.from_address_json[0].name || "";
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

  // Use AI-powered extraction
  const extracted = await extractReply(emailBodyText || emailBodyHtml || "");

  const emailSignature = extracted.reply
    ? splitOnParagraphs(extracted.reply).slice(-2).join("\n\n")
    : "";

  const phoneFromEmail = extractPhoneFromText(extracted.reply);

  console.log(colorize("Extracted Email Content", "cyan"), extracted.reply);

  return {
    "Column 1": process.env.AGENT_NAME || "instaSheet agent x1",
    "For scheduling": "",
    "sales person": extracted.salesPerson || "",
    "sales person email": extracted.salesPersonEmail || "",
    company: lead?.company_name || lead?.company || "",
    "company phone#": lead?.phone || "none",
    "phone#from email": phoneFromEmail || "none",
    "lead first name": extractReply.senderFirstName || firstName,
    "lead last name": extractReply.senderLastName || lastName,
    "lead email": leadEmail,
    "Column 2": leadEmail,
    "email reply": extracted.reply || "",
    "phone 1": phone1,
    "#": phone1, // keeping same as phone 1
    phone2: phone2,
    address: payload.address || lead?.address || "",
    city: payload.city || lead?.city || "",
    state: payload.state || lead?.state || payload.organization_state|| "",
    zip: payload.zip || payload.zip_code || payload.organization_postal_code ||"",
    details: payload.details || lead?.details || lead?.website || "",
    "Email Signature": extracted.signature || emailSignature || "",
    "linkedin link": "none",
    "2nd contact person linked": "none",
    "status after the call": "none",
    "number of calls spoken with the leads": "",
    "@dropdown": "",
  };
}

module.exports = {
  mapToSheetRow,
};
