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
  // main method for manual processing of the lead replies
  // those email replies that were not encoded the day it was set as interested
  getInterestedRepliesOnly_ = async (req, res) => {
    try {
      // req paramaters
      // sheetName is the name of the sheet that the interested leads will be appended on
      // opts can have these values
      //  "is_unread": true, Selecting only the emmails that was not read
      //   "delayMs": 300, delay per request in fetching the leads
      //   "pageLimit": 10, amount or nummber of leads per request
      //   "emailsPerLead": 1, emails to get per email
      //   "maxEmails": 20, maximumm emails to process, if reached the loop will stop
      //   "maxPages": 10, maximumm pages to process, if reached the loop will stop
      //   "aiInterestThreshold": 1 ai threshold in fetching the leads

      const {
        opts,
        sheetName,
        sheetNameForPartnership,
        autoAppend,
        descriptionExtraction,
      } = req.body;
      if (!opts || !sheetName || !sheetNameForPartnership) {
        return responseReturn(res, 400, {
          error: "SheetName or interested leads and for partnership and Options is required",
        });
      }

      const authHeaders = getAuthHeaders(env.INSTANTLY_API_KEY);
      let i = 0;

      // redis database prerequisites
      // the text as identifier of the emails
      const dedupKey = `insta:processed_emails`;
      // list of the emails that are already processed
      const seenMembers = await redisClient.sMembers(dedupKey);
      const seen = new Set(seenMembers);

      // context container
      // contains how much is processed and  fetched
      const runCtx = createRunContext();

      // initialization of the container of the total processed and  fetched
      const state = initState({
        initialSeenCount: seen.size,
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
      });

      // emmiting the current progress via socket
      emitProgress({ ctx: state });
      let cursor = null;

      // while loop -> checks first if the thresholds has not been reached yet
      while (shouldContinue(state) && !runCtx.errorOccurred) {
    
        // appending +1 of the pages that is fetched
        state.nextPage();
       

        // fetching the lead's details
        const { leads, nextCursor } = await fetchAndNormalizeLeads({
          cursor,
          opts,
          authHeaders,
          runContext: runCtx,
        });

        // sets the next cursor for the next request
        // cursor is based on the page limit to prevent fething the same page
        cursor = nextCursor;

        //Distination Sheet ID (not the sheet to append the replies)
        const spreadsheetId = env.SPREADSHEET_ID;

        // filtering the new and upprocessed leads
        // setting it to processed after gets done
        // returns an array of the unprocessed leads
        const { newLeads, error } = await filterNewLeads(
          leads,
          seen,
          sheetName,
          sheetNameForPartnership,
          spreadsheetId
        );
        console.log(colorize(`[ lead count ${newLeads.length}]`, "lightCyan"));
        if (!newLeads.length) continue;

        // each item of the array one by one
        for (const lead of newLeads) {
          // appending +1 to the total of leads processed
          i++
          console.log("---------------------------------------------- state")
          console.log(i)
          state.nextLead();
          console.log("state")
          console.log(state)
     

          // fetching the email replies of the leads
          const interestedEmails = await getInterestedReplies({
            lead,
            opts,
            authHeaders,
            redisClient,
            dedupKey,
            seen,
            runContext: runCtx,
          });

          // Processing each emails fetched
          for (const email of interestedEmails) {
            // Checking if any errors has occurred
            if (runCtx.errorOccurred) break;

            // Placing the values from the combination from the data for the lead and email
            const processed = await processEmailWithRetry({
              lead,
              email,
              sheetName,
              runContext: runCtx,
              autoAppend,
              descriptionExtraction,
            });

            // if the process was done and no errors has occured set the lead email as processed
            if (processed) {
              const key = normalizeKey(lead.email || lead.lead) || lead.id;
              if (key) await markProcessed(key, redisClient, dedupKey, seen);
            }
          }

        //     console.log("state")
        // console.log(state)
          emitProgress({ ctx: state, show: false });
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
