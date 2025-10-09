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
  // Skip leads with no replies
  if (!lead.email_reply_count || lead.email_reply_count === 0) {
    console.log(`[SKIP] No replies for lead: ${lead.email}`);
    return { lead, emails: [], skipped: true, reason: "No replies" };
  }

  // Build query parameters
  const params = {
    limit: perLeadLimit,
    leadEmail: lead.email || lead.payload?.email,
    // campaign: campaignId || lead.campaign,
  };

  console.log("fetchRepliesForLead START", params);

  try {
    // Global rate limit (e.g., max 20/min)
    await _awaitRateLimit();

    // Optional delay between requests
    const delay = Number(delayMs ?? process.env.REPLIES_REQUEST_DELAY_MS ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    // Fetch replies from Instantly API
    const response = await axios.get(`https://api.instantly.ai/api/v2/emails?lead=${lead.email}&email_type=received&sort_order=desc&limit=${perLeadLimit}`, {
      headers: authHeaders,
      // params,
    });
    // const response = await axios.get("https://api.instantly.ai/api/v2/emails", {
    //   headers: authHeaders,
    //   params,
    // });

    // console.log(response.data)
    // console.dir(response.data, { depth: null, colors: true });
    // console.log("response GET_EMAIL");
    const emails = normalizeLeadsArray(response.data || []);
    // console.log(`fetchRepliesForLead END for ${params.leadEmail}`);

    console.log(`EMAILS for ${params.leadEmail}`)
    console.dir(emails, { depth: null, colors: true });
    return { lead, emails, success: true };
  } catch (err) {
    console.error(
      `fetchRepliesForLead ERROR for ${params.leadEmail}:`,
      err.message
    );
    return { lead, emails: [], error: err.message, success: false };
  }
}

// async function fetchRepliesForLead(
//   lead,
//   { campaignId, perLeadLimit, authHeaders, delayMs }
// ) {
//   // Build query parameters
//   const params = {
//     limit: perLeadLimit,
//     leadEmail : lead.email | lead.payload.email,
//   };

//   console.log("fetchRepliesForLead 02 START");
//   console.log(params);

//   try {
//     // Global rate limit (max 20/min)
//     await _awaitRateLimit();

//     // Optional delay before each request to throttle
//     const delay =
//       Number(delayMs ?? process.env.REPLIES_REQUEST_DELAY_MS ?? 0) || 0;
//     if (delay > 0) {
//       await new Promise((r) => setTimeout(r, delay));
//     }

//     const response = await axios.get(`https://api.instantly.ai/api/v2/emails`, {
//       headers: authHeaders,
//       params,
//     });
//     // const response = await axios.get(`https://api.instantly.ai/api/v2/emails?lead=${leadEmail}&email_type=received&sort_order=desc&limit=${limit}`, {
//     //   headers: authHeaders,
//     //   params,
//     // });

//     // const response = await axios.get(`${API_BASE}${EMAILS_PATH}`, {
//     //   headers: authHeaders,
//     //   params,
//     // });

//     console.log("response");
//     console.log(response.data);
//     const emails = normalizeLeadsArray(response.data);
//     console.log("fetchRepliesForLead -Emails");

//     console.log("fetchRepliesForLead 02 END");
//     return { lead, emails };
//   } catch (err) {
//     console.log(err);
//     console.log("[SKIP] fetchRepliesForLead");
//     // Return error per‐lead so batch continues
//     return { lead, emails: [], error: err.message };
//   }
// }

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
      fetchRepliesForLead(lead, {
        campaignId,
        perLeadLimit,
        authHeaders,
        delayMs,
      })
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
