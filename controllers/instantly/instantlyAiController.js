const { responseReturn } = require("../../utils/response");
const env = require("../../env");
const redisClient = require("../../config/redisClient");
const { emitProgress } = require("../../events/progressEmitter");
const {
  fetchAndNormalizeLeads,
} = require("../../services/instantly/lead/normalizeService");
const { getAuthHeaders } = require("../../utils/auth");
const {
  filterNewLeads,
  normalizeKey,
  markProcessed,
} = require("../../services/dedupService");
const {
  initState,
  shouldContinue,
  summarizeState,
  createRunContext,
  activeRunContexts,
} = require("../../services/stateService");
const { handleError } = require("../../services/errorService");
const loggerController = require(".././loggerController");
const {
  processEmailWithRetry,
} = require("../../services/email/emailProcessing");
const {
  getInterestedReplies,
} = require("../../services/instantly/lead/replyService");
const { colorize } = require("../../utils/colorLogger");


class instantlyAiController {
  
  getInterestedRepliesOnly_ = async (req, res) => {
    try {
      const { opts, sheetName, autoAppend } = req.body;
      const authHeaders = getAuthHeaders(env.INSTANTLY_API_KEY);

      const dedupKey = `insta:processed_emails`;
      const seenMembers = await redisClient.sMembers(dedupKey);
      const seen = new Set(seenMembers);

      const runCtx = createRunContext();

      const state = initState({
        initialSeenCount: seen.size,
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
      });

      emitProgress({ctx:state});
      let cursor = null;

      while (shouldContinue(state) && !runCtx.errorOccurred) {
        state.nextPage();

        const { leads, nextCursor } = await fetchAndNormalizeLeads({
          cursor,
          opts,
          authHeaders,
          runContext: runCtx,
        });
        cursor = nextCursor;


        const spreadsheetId = env.SPREADSHEET_ID

        const {newLeads,error} = await filterNewLeads(leads, seen, sheetName, spreadsheetId);
        console.log(colorize(`[ lead count ${newLeads.length}]`,"lightCyan"))
        if (!newLeads.length) continue;

        for (const lead of newLeads) {
          state.nextLead();
          const interestedEmails = await getInterestedReplies({
            lead,
            opts,
            authHeaders,
            redisClient,
            dedupKey,
            seen,
            runContext: runCtx,
          });

          for (const email of interestedEmails) {
            if (runCtx.errorOccurred) break;

            const processed = await processEmailWithRetry({
              lead,
              email,
              sheetName,
              runContext: runCtx,
              autoAppend,
            });

            if (processed) {
              const key = normalizeKey(lead.email || lead.lead) || lead.id;
              if (key) await markProcessed(key, redisClient, dedupKey, seen);
            }
          }

          emitProgress({ctx:state,show:false});
        }
      }

      const summary = summarizeState(state);
      await loggerController.addNewLog(summary);
      return responseReturn(res, 200, summary);
    } catch (err) {
      return handleError(err, res);
    }
  };

  stopEncodingRun = async (req, res) => {
    try {
      console.log("STOP ENCODING RUN INITIATED");

      const { runId } = req.body; // optional: identify which run to stop
      const targetRunCtx = runId
        ? activeRunContexts.get(runId)
        : activeRunContexts.get("default");

      if (!targetRunCtx) {
        return responseReturn(res, 404, {
          message: "No active encoding run found.",
        });
      }

      targetRunCtx.errorOccurred = true;
      targetRunCtx.errorContext = "Manually stopped by user";

      responseReturn(res, 200, {
        message: "Encoding run successfully stopped.",
        runId: runId || "default",
      });
    } catch (error) {
      console.error("Error stopping encoding run:", error);
      responseReturn(res, 500, {
        message: "Error stopping the encoding run.",
        error: error.message,
      });
    }
  };
}

module.exports = new instantlyAiController();
