// services/emailService.js
const axios = require("axios");
const { normalizeLeadsArray } = require("../utils/leads");
const { countWords } = require("../utils/wordCounter");
const { colorize } = require("../utils/colorLogger");

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
  { perLeadLimit, authHeaders, delayMs, setErrorContext,
  setErrorOccurred }
) {
  // Skip leads with no replies
  if (!lead.email_reply_count || lead.email_reply_count === 0) {
    console.log(`[SKIP] No replies for lead: ${lead.email}`);
    return { lead, emails: [], skipped: true, reason: "No replies" };
  }

  // Build query parameters (no campaign_id)
  const params = {
    lead: lead.email || lead.payload?.email,
    email_type: "received",
    sort_order: "desc",
    limit: perLeadLimit
  };

  console.log("fetchRepliesForLead START", params);

  try {
    // Global rate-limit guard
    await _awaitRateLimit();

    // Optional inter-request delay
    if (delayMs > 0) {
      await new Promise((res) => setTimeout(res, Number(delayMs)));
    }

    // Fetch from Instantly
    const response = await axios.get(
      "https://api.instantly.ai/api/v2/emails",
      {
        headers: authHeaders,
        params,
      }
    );

    console.dir(response.data, { depth: null, colors: true });
    const emails = normalizeLeadsArray(response.data || []);
    const firstBody = emails[0]?.body?.text || "";
    const wordCount = await countWords(firstBody);

    console.log(
      colorize(
        `Fetched ${emails.length} replies for ${params.lead} -> ${wordCount} words in first email`,
        "cyan"
      )
    );

    return { lead, emails, success: true };
  } catch (error) {
    console.error(`fetchRepliesForLead : ${lead.email}:`, error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(`fetchRepliesForLead : ${err.message}`);
    return { lead, emails: [], error: err.message, success: false };
  }
}

module.exports = {
  fetchRepliesForLead,
};
