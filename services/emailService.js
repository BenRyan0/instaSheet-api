// services/emailService.js

const axios = require("axios");
const pLimit = require("p-limit").default;
const { API_BASE, EMAILS_PATH } = require("../config");
// const API_BASE= "https://api.instantly.ai"
// const EMAILS_PATH = "/api/v2/emails"
const { normalizeLeadsArray } = require("../utils/leads");

async function fetchRepliesForLead(
  lead,
  { campaignId, perLeadLimit, authHeaders }
) {
  console.log("fetchRepliesForLead")
  // Build query parameters
  const params = {
    campaign_id: campaignId,
    email_type: "received",
    sort_order: "desc",
    i_status: 1,
    is_unread: true,
    limit: perLeadLimit,
    ...(lead.id ? { lead_id: lead.id } : { lead: lead.email || lead.lead }),
  };

  try {
    const response = await axios.get(`${API_BASE}${EMAILS_PATH}`, {
      headers: authHeaders,
      params,
    });
    // console.log(response)
    // console.log("response -fetchRepliesForLead")
    // Normalize array shape if API nests under a key

    const emails = normalizeLeadsArray(response.data);
    // console.log("emails -fetchRepliesForLead START");
    // emails.forEach((email, i) => {
    //   console.log(`\n--- EMAIL ${i + 1} ---`);
    //   console.log("ID:", email.id);
    //   console.log("Subject:", email.subject);

    //   // Expand the from/to arrays
    //   console.log("From Address JSON:");
    //   console.dir(email.from_address_json, { depth: null, colors: true });

    //   console.log("To Address JSON:");
    //   console.dir(email.to_address_json, { depth: null, colors: true });
    // });

    // console.log(emails);
    // emails.from_address_json.forEach((obj, i) => {
    //   console.log(`From EMAIL DATA ${i}:`);
    //   console.dir(obj, { depth: null });
    // });

    // console.log("emails -fetchRepliesForLead END");
    return { lead, emails };
  } catch (err) {
    // Return error per‐lead so batch continues
    return { lead, emails: [], error: err.message };
  }
}

async function fetchRepliesForLeadsBatch(
  leads,
  { campaignId, perLeadLimit, concurrency, authHeaders }
) {

  console.log("fetchRepliesForLeadsBatch")
  // Create a limiter so no more than `concurrency` HTTP calls run at once
  const limit = pLimit(concurrency);
  // Wrap each fetch in the limiter
  const tasks = leads.map((lead) =>
    limit(() =>
      fetchRepliesForLead(lead, { campaignId, perLeadLimit, authHeaders })
    )
  );
  // Await all fetches; errors are captured per‐lead
  return Promise.all(tasks);
}

module.exports = {
  fetchRepliesForLead,
  fetchRepliesForLeadsBatch,
};
