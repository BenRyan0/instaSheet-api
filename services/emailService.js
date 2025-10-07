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
  console.log("fetchRepliesForLead");
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
 
    console.log("response")
    console.log(response.data)
    const emails = normalizeLeadsArray(response.data);

    return { lead, emails };
  } catch (err) {
    console.log(err)
    console.log("[SKIP] fetchRepliesForLead")
    // Return error per‐lead so batch continues
    return { lead, emails: [], error: err.message };
  }
}

async function fetchRepliesForLeadsBatch(
  leads,
  { campaignId, perLeadLimit, concurrency, authHeaders }
) {
  console.log("fetchRepliesForLeadsBatch");
  console.log(`fetchRepliesForLeadsBatch: ${concurrency}`)
  console.log("leads")
  console.log(leads.length)
  // Create a limiter so no more than `concurrency` HTTP calls run at once
  const limit = pLimit(concurrency);
  // Wrap each fetch in the limiter
  const tasks = leads.map((lead) =>
    limit(() =>
      fetchRepliesForLead(lead, { campaignId, perLeadLimit, authHeaders })
    )
  );

  console.log("tasks")
  console.log(tasks)
  // Await all fetches; errors are captured per‐lead
  return Promise.all(tasks);
}

module.exports = {
  fetchRepliesForLead,
  fetchRepliesForLeadsBatch,
};
