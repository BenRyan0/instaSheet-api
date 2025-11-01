const { colorize } = require("../../../utils/colorLogger");
const { isInterestedReply } = require("../../../utils/filters");
const { normalizeKey, markProcessed } = require("../../dedupService");
const { fetchRepliesForLead } = require("../../emailService");




async function getInterestedReplies({
    lead,
    opts,
    authHeaders,
    redisClient,
    dedupKey,
    seen,
    setErrorOccurred,
    setErrorContext,
  }) {
 
    const result = await fetchRepliesForLead(lead, {
      perLeadLimit: opts.emailsPerLead,
      authHeaders,
      delayMs: opts.delayMs,
      is_unread: opts.is_unread,
      setErrorOccurred,
      setErrorContext,
    });

    if (result.skipped || result.error) {
      // const key = normalizeKey(lead.email || lead.lead) || lead.id;
      // if (key) await markProcessed(key, redisClient, dedupKey, seen);
      return [];
    }

    try {
      return result.emails.filter((e) =>
        isInterestedReply(e, opts.aiInterestThreshold)
      );
    } catch (err) {
      console.warn("Interest filtering failed:", err.message);
      return [];
    }
  }

module.exports = {
  getInterestedReplies
}