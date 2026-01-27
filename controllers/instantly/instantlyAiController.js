const { responseReturn } = require("../../utils/response");
const env = require("../../env");
const redisClient = require("../../config/redisClient");
const { emitProgress } = require("../../events/progressEmitter");
const {
  fetchAndNormalizeLeads,
  fetchAndNormalizeLeadDetails,
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
  clearRunContext,
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
const {
  incrementTotalFetchedLeads,
} = require("../../services/instantly/lead/encodeService");
const {
  default: flushToRedis,
  flushLocalCacheToRedis,
} = require("../../services/Redis/flushToRedis");

// TOP DEL
const axios = require("axios");
const { leadReplyDataMapper, ReplyDataMapper } = require("../../mappers/sheetRow");

class instantlyAiController {
  // main method for manual processing of the lead replies
  // those email replies that were not encoded the day it was set as interested
  getInterestedRepliesOnly_ = async (req, res) => {
    let runCtx;
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
        sheetNameForSBA,
        clientId,
      } = req.body;

      const sheetNameForHotLead = "Hot Leads";
      console.log(req.body);

      if (!opts || !sheetName || !sheetNameForPartnership || !sheetNameForSBA) {
        return responseReturn(res, 400, {
          error:
            "SheetName for interested leads for offer, partnership, SBA and Options is required",
        });
      }
      if (!clientId) {
        return responseReturn(res, 400, {
          error:
            "Please do login, if already logged in kindly reload the webpage",
        });
      }

      // await redisClient.sAdd("insta:processed_emails", "manual_test_email");

      //Distination Sheet ID (not the sheet to append the replies)
      const spreadsheetId = env.SPREADSHEET_ID;
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
      runCtx = createRunContext({
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
      });

      // initialization of the container of the total processed and  fetched
      const state = initState({
        initialSeenCount: seen.size,
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
        runId: runCtx.runId,
      });

      // emmiting the current progress via socket
      emitProgress({ clientId, ctx: runCtx });
      let cursor = null;

      // while loop -> checks first if the thresholds has not been reached yet
      while (shouldContinue(runCtx) && !runCtx.errorOccurred) {
        // appending +1 of the pages that is fetched
        runCtx.nextPage();
        emitProgress({ clientId, ctx: runCtx, show: true });

        // fetching the lead's details
        const { leads, nextCursor } = await fetchAndNormalizeLeads({
          cursor,
          opts,
          authHeaders,
          runContext: runCtx,
        });

        runCtx.addTotalFetchedLeads(leads.length);

        // sets the next cursor for the next request
        // cursor is based on the page limit to prevent fething the same page
        cursor = nextCursor;

        // filtering the new and upprocessed leads
        // setting it to processed after gets done
        // returns an array of the unprocessed leads
        const sheetNames = [
          sheetName,
          sheetNameForPartnership,
          sheetNameForSBA,
          sheetNameForHotLead,
        ];

        const { newLeads, error } = await filterNewLeads(
          leads,
          seen,
          spreadsheetId,
          sheetNames,
          { runCtx }
        );

        console.log(colorize(`[ lead count ${newLeads.length}]`, "lightCyan"));
        if (!newLeads.length) continue;

        // each item of the array one by one
        for (const lead of newLeads) {
          // appending +1 to the total of leads processed

          runCtx.nextLead();
          emitProgress({ clientId, ctx: runCtx, show: true });

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
              sheetNameForPartnership,
              sheetNameForSBA,
              runContext: runCtx,
              autoAppend,
              descriptionExtraction,
              state,
              clientId,
              runCtx,
            });

            // if the process was done and no errors has occured set the lead email as processed
            if (processed) {
              const key = normalizeKey(lead.email || lead.lead) || lead.id;
              if (key) await markProcessed(key, redisClient, dedupKey, seen);
            }
          }

          emitProgress({ clientId, ctx: runCtx, show: true });
        }
      }

      emitProgress({ clientId, ctx: runCtx, show: true });

      const summary = summarizeState(runCtx);
      await loggerController.addNewLog(summary);
      await incrementTotalFetchedLeads(runCtx.totalEmailsCollected);

      await flushLocalCacheToRedis(redisClient, dedupKey, seen);

      return responseReturn(res, 200, summary);
    } catch (err) {
      return handleError(err, res);
    } finally {
      if (runCtx) {
        console.log(`Clearing run context for ${runCtx.runId}`);
        clearRunContext(runCtx.runId);
      }
    }
  };

  getLeadDetails = async (req, res) => {
    const { leadEmail } = req.body;

    if (!leadEmail) {
      return responseReturn(res, 400, { message: "leadEmail is required" });
    }

    const authHeaders = getAuthHeaders(env.INSTANTLY_API_KEY);
    console.log(`Fetching details for lead email: ${leadEmail}`);

    const state = initState({
      initialSeenCount: 0,
      maxEmails: 0,
      maxPages: 0,
      aiInterestThreshold: 0,
      runId: "manual_fetch_lead_details",
    });

    try {
      let lead = await this.getLeadDetail(leadEmail, authHeaders);
      let email = null;

      if (lead) {
        console.log(`Lead found for ${leadEmail}`);
        email = await this.getLeadEmailReply(lead, authHeaders);
      } else {
        console.log(
          `No lead found for ${leadEmail}, fetching by email instead...`
        );
        email = await this.getLeadEmailReply1(leadEmail, authHeaders);
      }

      console.log("Lead data:", lead || leadEmail);
      console.log("Lead reply:", email);

      let row = null;
      let type = null;

      if (email && lead) {
        // Both lead and email exist
        console.log("Processing with leadReplyDataMapper (lead + email)...");
        row = await leadReplyDataMapper({
          lead,
          email,
          setErrorOccurred: state.setErrorOccurred,
          setErrorContext: state.setErrorContext,
        });
        type = "lead_and_email";
      } else if (email && !lead) {
        // Only email exists, no lead
        console.log("Processing with leadReplyDataMapper1 (email only)...");
        row = await ReplyDataMapper({
          email,
          setErrorOccurred: state.setErrorOccurred,
          setErrorContext: state.setErrorContext,
        });
        type = "email_only";
      } else {
        console.log("No email or lead data found to process.");
        return responseReturn(res, 400, {
          error: "No valid data to process (missing email and lead)",
        });
      }

      console.log("Mapped row data:");
      console.log(row)

      return responseReturn(res, 200, {
        message: "Lead details fetched successfully",
        row,
        type
      });
    } catch (error) {
      console.error("Error fetching lead details:", error.message || error);
      return responseReturn(res, 500, {
        error: "Failed to fetch lead details",
      });
    }
  };

  getLeadDetail = async (leadEmail, authHeaders) => {
    try {
      const response = await axios.post(
        "https://api.instantly.ai/api/v2/leads/list",
        { contacts: leadEmail, limit: 1 },
        { headers: { ...authHeaders, "Content-Type": "application/json" } }
      );

      const data = response.data;
      const lead = data && data.items && data.items[0] ? data.items[0] : null;

      if (!lead) console.log(`No lead data returned for ${leadEmail}`);
      return lead;
    } catch (error) {
      console.error("Error fetching lead detail:", error.message || error);
      return null;
    }
  };

  getLeadEmailReply = async (lead, authHeaders) => {
    try {
      const leadEmail =
        (lead && lead.email) || (lead.payload && lead.payload.email);
      if (!leadEmail) {
        console.log("No valid email found for lead.");
        return null;
      }

      const response = await axios.get(
        "https://api.instantly.ai/api/v2/emails",
        {
          headers: authHeaders,
          params: {
            lead: leadEmail,
            email_type: "received",
            sort_order: "desc",
            limit: 1,
          },
        }
      );

      const data = response.data;
      const reply = data && data.items && data.items[0] ? data.items[0] : null;

      if (!reply) console.log(`No email replies found for ${leadEmail}`);
      return reply;
    } catch (error) {
      console.error("Error fetching lead email reply:", error.message || error);
      return null;
    }
  };
  getLeadEmailReply1 = async (leadEmail, authHeaders) => {
    try {
      if (!leadEmail) {
        console.log("No valid email found for lead.");
        return null;
      }

      const response = await axios.get(
        "https://api.instantly.ai/api/v2/emails",
        {
          headers: authHeaders,
          params: {
            lead: leadEmail,
            email_type: "received",
            sort_order: "desc",
            limit: 1,
          },
        }
      );

      const data = response.data;
      const reply = data && data.items && data.items[0] ? data.items[0] : null;

      if (!reply) console.log(`No email replies found for ${leadEmail}`);
      return reply;
    } catch (error) {
      console.error("Error fetching lead email reply:", error.message || error);
      return null;
    }
  };

  // controllers/encodingController.js
  stopEncodingRun = async (req, res) => {
    try {
      console.log("STOP ENCODING RUN INITIATED");

      const { runId } = req.body; // Explicitly provided run ID
      console.log(`runId ${runId}`);

      if (!runId) {
        return responseReturn(res, 400, {
          message: "Missing runId in request body.",
        });
      }

      // Look up the target run context using the provided runId
      const targetRunCtx = activeRunContexts.get(runId);

      if (!targetRunCtx) {
        return responseReturn(res, 404, {
          message: `No active run context found for runId: ${runId}`,
        });
      }

      // Gracefully stop this run
      targetRunCtx.errorOccurred = true;
      targetRunCtx.errorContext = "Manually stopped by user";

      console.log(`Run ${runId} has been manually stopped.`);

      // Optional: emit a progress update to notify frontend immediately
      emitProgress({
        clientId: targetRunCtx.clientId || "unknown",
        ctx: targetRunCtx,
        show: true,
        message: "Run manually stopped by user",
      });
      // Optional cleanup: remove from active contexts after stopping
      clearRunContext(runId);

      return responseReturn(res, 200, {
        message: `Encoding run successfully stopped.`,
        runId,
      });
    } catch (error) {
      console.error("Error stopping encoding run:", error);
      return responseReturn(res, 500, {
        message: "Error stopping the encoding run.",
        error: error.message,
      });
    }
  };
}

module.exports = new instantlyAiController();
