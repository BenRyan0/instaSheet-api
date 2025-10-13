// services/emailService.js

const axios = require("axios");
const pLimit = require("p-limit").default;
const { API_BASE, EMAILS_PATH } = require("../config");
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
    const response = await axios.get(
      `https://api.instantly.ai/api/v2/emails?lead=${lead.email}&campaign_id=${campaignId}&email_type=received&sort_order=desc&limit=${perLeadLimit}&i_status=1&is_unread=true`,
      {
        headers: authHeaders,
      }
    );

    const emails = normalizeLeadsArray(response.data || []);
    const emailContent = emails[0]?.body?.text || "";

    const emailWordCount = await countWords(emailContent);
    if (emailWordCount < 20) {
      console.log(colorize(`Email for ${params.leadEmail} fetched -> ${emailWordCount} words`, "cyan"));
    }

    return { lead, emails, success: true };
  } catch (err) {
    console.error(
      `fetchRepliesForLead ERROR for ${params.leadEmail}:`,
      err.message
    );
    return { lead, emails: [], error: err.message, success: false };
  }
}



module.exports = {
  fetchRepliesForLead
};
