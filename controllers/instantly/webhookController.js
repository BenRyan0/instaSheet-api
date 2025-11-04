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
  shouldContinue,
} = require("../../services/stateService");
const {
  getInterestedReplies,
} = require("../../services/instantly/lead/replyService");
const {
  processEmailWithRetry,
} = require("../../services/email/emailProcessing");
const { delay } = require("../../utils/helpers");
const loggerController = require(".././loggerController");
const { colorize } = require("../../utils/colorLogger");
const { incrementTotalFetchedLeads } = require("../../services/instantly/lead/encodeService");

class webhookController {
  // LEAD PROCESSING FROM WEB HOOK
  async encodeInterestedRepliesByWebhook({
    opts,
    sheetName,
    sheetNameForPartnership,
    autoAppend,
    descriptionExtraction,
  }) {
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

      let errorBatchCount = 0;
      let noLeadsBatchCount = 0; // <-- NEW: counts consecutive empty lead fetches

      while (shouldContinue(state) && !runCtx.errorOccurred) {
        // Fetch & normalize leads from webhook
        const leads = await fetchAndNormalizeLeadsWebhook({
          opts,
          authHeaders,
          runContext: runCtx,
        });
        state.addTotalFetchedLeads(leads.length);

        // NEW: detect empty leads 3 times in a row → stop
        if (!leads || leads.length === 0) {
          noLeadsBatchCount++;
          console.log(`No unprocessed emails found. (${noLeadsBatchCount}/3)`);

          if (noLeadsBatchCount >= 3) {
            console.log("Stopping loop after 3 consecutive empty batches.");
            break;
          }

          await delay(2000); // small wait before retrying
          continue; // skip rest of the loop
        } else {
          // Reset the counter once we successfully fetch new leads
          noLeadsBatchCount = 0;
        }

        const spreadsheetId = env.SPREADSHEET_ID;
        const { newLeads, error } = await filterNewLeads(
          leads,
          seen,
          sheetName,
          sheetNameForPartnership,
          spreadsheetId
        );

        if (error) {
          errorBatchCount++;
          console.log(colorize(`(${errorBatchCount}/3)`, "bgLightRed"));
          if (errorBatchCount >= 3) break;
          await delay(2000);
          continue;
        }
        errorBatchCount = 0;

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
              sheetNameForPartnership,
              runContext: runCtx,
              autoAppend,
              descriptionExtraction,
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
       await incrementTotalFetchedLeads(state.totalEmailsCollected)
      return summary;
    } catch (err) {
      console.error("Fatal error in encodeInterestedRepliesByWebhook:", err);
      return { error: true, message: err.message };
    }
  }
}

module.exports = new webhookController();
