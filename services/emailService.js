// services/emailService.js

const axios = require("axios");
const pLimit = require("p-limit").default;
const { API_BASE, EMAILS_PATH } = require("../config");
const { normalizeLeadsArray } = require("../utils/leads");

// Global rate limiter: enforce max 20 requests/min (~1 every 3000ms)
let _rateGate = Promise.resolve(0);
const ONE_REQUEST_EVERY_MS = 3000; // 60s / 20

async function _awaitRateLimit() {
  const scheduled = _rateGate.then(async (lastTime) => {
    const now = Date.now();
    const wait = Math.max(0, (lastTime || 0) + ONE_REQUEST_EVERY_MS - now);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    return Date.now();
  });
  _rateGate = scheduled.catch(() => Date.now());
  await scheduled;
}

async function fetchRepliesForLead(
  lead,
  { campaignId, perLeadLimit, authHeaders, delayMs }
) {
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
    // Global rate limit (max 20/min)
    await _awaitRateLimit();

    // Optional delay before each request to throttle
    const delay = Number(delayMs ?? process.env.REPLIES_REQUEST_DELAY_MS ?? 0) || 0;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    const response = await axios.get(`${API_BASE}${EMAILS_PATH}`, {
      headers: authHeaders,
      params,
    });
 
    // console.log("response")
    // console.log(response.data)
    const emails = normalizeLeadsArray(response.data);
    console.log("fetchRepliesForLead -Emails")
    // console.log(emails)

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
  { campaignId, perLeadLimit, concurrency, authHeaders, delayMs }
) {
  // console.log("fetchRepliesForLeadsBatch");
  // console.log(`fetchRepliesForLeadsBatch: ${concurrency}`)
  // console.log("leads")
  // console.log(leads.length)
  // Create a limiter so no more than `concurrency` HTTP calls run at once
  const limit = pLimit(concurrency);
  // Wrap each fetch in the limiter
  const tasks = leads.map((lead) =>
    limit(() =>
      fetchRepliesForLead(lead, { campaignId, perLeadLimit, authHeaders, delayMs })
    )
  );

  // console.log("tasks")
  // console.log(tasks)
  // Await all fetches; errors are captured per‐lead
  return Promise.all(tasks);
}

module.exports = {
  fetchRepliesForLead,
  fetchRepliesForLeadsBatch,
};
