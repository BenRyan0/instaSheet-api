const env = require("../../env");
const { getAuthHeaders } = require("../../utils/auth");
const redisClient = require("../../config/redisClient");
const {
  fetchAndNormalizeLeadsWebhook,
} = require("../../services/instantly/lead/normalizeService");
const {
  filterNewLeads,
  normalizeKey,
  markProcessed,
} = require("../../services/dedupService");
const {
  initState,
  summarizeState,
  createRunContext,
} = require("../../services/stateService");
const {
  getInterestedReplies,
} = require("../../services/instantly/lead/replyService");
const {
  processEmailWithRetry,
} = require("../../services/email/emailProcessing");
const { delay } = require("../../utils/helpers");
const loggerController = require(".././loggerController");

class webhookController {
  // LEAD PROCESSING FROM WEB HOOK
  async encodeInterestedRepliesByWebhook({ opts, sheetName }) {
    try {
      const authHeaders = getAuthHeaders(env.INSTANTLY_API_KEY);

      // Initialize Redis de-duplication
      const dedupKey = `insta:processed_emails`;
      const seenMembers = await redisClient.sMembers(dedupKey);
      const seen = new Set(seenMembers);

      // Context and state
      const runCtx = createRunContext();
      const state = initState({
        initialSeenCount: seen.size,
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
      });

      let emptyBatchCount = 0;

      while (!runCtx.errorOccurred) {
        // Fetch & normalize leads from webhook
        const leads = await fetchAndNormalizeLeadsWebhook({
          opts,
          authHeaders,
          runContext: runCtx,
        });

        // Filter unseen leads
        const newLeads = filterNewLeads(leads, seen);
        if (!newLeads.length) {
          emptyBatchCount++;
          console.log(`No new leads found (${emptyBatchCount}/3)...`);
          if (emptyBatchCount >= 3) break;
          await delay(2000);
          continue;
        }
        emptyBatchCount = 0;

        // Process each lead
        for (const lead of newLeads) {
          const interestedEmails = await getInterestedReplies({
            lead,
            opts,
            authHeaders,
            redisClient,
            dedupKey,
            seen,
            runContext: runCtx,
          });

          // Process each interested email
          for (const email of interestedEmails) {
            if (runCtx.errorOccurred) break;

            const processed = await processEmailWithRetry({
              lead,
              email,
              sheetName,
              runContext: runCtx,
            });

            if (processed) {
              const key = normalizeKey(lead.email || lead.id);
              if (key) await markProcessed(key, redisClient, dedupKey, seen);
            }
          }
        }
      }

      const summary = summarizeState(state);
      await loggerController.addNewLog(summary);
      return summary;
    } catch (err) {
      console.error("Fatal error in encodeInterestedRepliesByWebhook:", err);
      return { error: true, message: err.message };
    }
  }
}

module.exports = new webhookController();
