const { responseReturn } = require("../utils/response");
require("dotenv").config({ silent: true });
const BASE_URL = "https://api.instantly.ai/api/v2/campaigns";
const PAGE_SIZE = 10;
const { colorize } = require("../utils/colorLogger");
const {
  normalizeRow,
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
  encodeToSheet,
} = require("../services/leadServices");
const redisClient = require("../config/redisClient");
const { emitProgress } = require("../events/progressEmitter");
const { normalizeLeadsArray } = require("../utils/leads");
const { mapToSheetRow } = require("../mappers/sheetRow");
const { getAuthHeaders } = require("../utils/auth");
const { fetchLeadsPage, getNextCursor } = require("../services/leadServices");
const {
  filterNewLeads,
  normalizeKey,
  markProcessed,
} = require("../services/dedupService");
const { fetchRepliesForLeadsBatch, fetchRepliesForLead } = require("../services/emailService");
const { isInterestedReply } = require("../utils/filters");
const {
  initState,
  shouldContinue,
  summarizeState,
} = require("../services/stateService");
const { handleError } = require("../services/errorService");

const loggerController = require("./loggerController");

class instantlyAiController {
  // Global variables accessible from other methods
  totalEncoded = 0;
  totalEnterestedLLM = 0;
  errorOccurred = false;

  // Setter for totalEncoded (overwrites)
  setTotalEncoded(val) {
    this.totalEncoded = val;
  }
  setTotalEnterestedLLM(val) {
    this.totalEnterestedLLM = val;
  }
  setErrorOccurred(val) {
    this.errorOccurred = val;
  }
  // Increment totalEncoded by a value (additive, does not reset)
  addToTotalEncoded(val) {
    this.totalEncoded += val;
  }
  addTotalEnterestedLLM(val) {
    this.totalEnterestedLLM += val;
  }

  // process a single email row, must return a Promise<boolean>
  getAllCampaigns = async (req, res) => {
    console.log("Fetching all campaigns from Instantly...");
    try {
      const headers = {
        Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
        "Content-Type": "application/json",
      };

      let campaigns = [];
      let cursor = null;

      do {
        // Build query string
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) params.set("starting_after", cursor);

        const resp = await fetch(`${BASE_URL}?${params}`, { headers });

        if (!resp.ok) {
          const errText = await resp.text();
          return responseReturn(res, resp.status, {
            error: `Failed to fetch campaigns: ${resp.status} ${errText}`,
          });
        }

        const { items = [], next_starting_after } = await resp.json();
        campaigns = campaigns.concat(items);
        cursor = next_starting_after || null;
      } while (cursor);

      console.log("Fetching all campaigns from Instantly -DONE");
      responseReturn(res, 200, {
        total: campaigns.length,
        campaigns,
      });
    } catch (err) {
      console.error("Error fetching all campaigns:", err.message);
      responseReturn(res, 500, { error: "Failed to fetch all campaigns" });
    }
  };

  async processEmailRow({ emailRow, sheetName }) {
    console.log(colorize("Processing lead Email ...", "blue"));
    const spreadsheetId = process.env.SPREADSHEET_ID;
    try {
      const rowJson = await normalizeRow(emailRow);

      // --- Step 1: Address present? ---
      if (rowJson.address || rowJson.city || rowJson.state || rowJson.zip) {
        const usAddress = await isAddressUsBased({
          city: rowJson.city,
          state: rowJson.state,
          address: rowJson.address,
          zip: rowJson.zip,
          setErrorOccurred: this.setErrorOccurred.bind(this),
        });
        if (!usAddress) return true; // Skip but still return true

        const interested = await isActuallyInterested(
          rowJson["email reply"],
          this.addTotalEnterestedLLM.bind(this),
          false
        );
        if (interested) {
          await encodeToSheet(
            spreadsheetId,
            sheetName,
            rowJson,
            this.addToTotalEncoded.bind(this)
          );
        }
        return true; // Continue flow regardless
      }
      // --- Step 2: Website present? ---
      if (rowJson.details) {
        const usWebsite = await isWebsiteUsBased(rowJson.details);
        if (!usWebsite) return true; // Skip but still return true

        const interested = await isActuallyInterested(
          rowJson["email reply"],
          this.addTotalEnterestedLLM.bind(this),
          false
        );
        if (interested) {
          await encodeToSheet(
            spreadsheetId,
            sheetName,
            rowJson,
            this.addToTotalEncoded.bind(this)
          );
        }
        return true; // Continue flow regardless
      }

      return true;
    } catch (err) {
      console.error("processEmailRow failed:", err.message);
      return true; // Ensure main flow continues even on error
    }
  }

  stopIncodingRun = async(req, res) =>{
    try {
      console.log("STOP INCODING RUNS INITIATED")
      this.setErrorOccurred(true)
      
      responseReturn(res, 200, {
        message: "Encoding Runs Successfuly Stopped"
      })
    } catch (error) {
      console.log(error)
      responseReturn(res, 500,{
        message: "Stopping the Encoding runs into error"
      })      
    }
  }

  getInterestedRepliesOnly_ = async (req, res) => {
    var i = 0;
    this.errorOccurred = false;
    try {
      const { campaignId, opts, sheetName } = req.body;
      // console.log(opts);
      const authHeaders = getAuthHeaders(process.env.INSTANTLY_API_KEY);

      const dedupKey = `insta:processed_emails:${campaignId}`;
      const seenMembers = await redisClient.sMembers(dedupKey);
      const seen = new Set(seenMembers);

      const state = initState({
        initialSeenCount: seen.size,
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
      });
      emitProgress(state);

      let cursor = null;
      // console.log(this.errorOccurred);
      // console.log("this.errorOccurred");
      while (shouldContinue(state) && !this.errorOccurred) {
        state.nextPage();
        const page = await fetchLeadsPage({
          campaignId,
          cursor,
          pageLimit: opts.pageLimit,
          aiThreshold: opts.aiInterestThreshold,
          authHeaders,
        });
        const leads = normalizeLeadsArray(page);
        cursor = getNextCursor(page);
        // console.log(cursor);
        // console.log("cursor");

        const batch = filterNewLeads(leads, seen);
        // console.log(batch.length);
        // console.log("batch.length");
        console.log(batch)
        if (batch.length === 0) continue;

        // Sequentially process each lead: wait for replies and email processing before next lead
        for (const lead of batch) {
          const { emails } = await fetchRepliesForLead(lead, {
            campaignId,
            perLeadLimit: opts.emailsPerLead,
            authHeaders,
            delayMs: opts.delayMs,
          });
          if (this.errorOccurred) break;
          state.nextLead();
          i++;
          emitProgress(state);

          console.log("i", i);
          // Dedup AFTER successful processing instead of before
          const emailKey = normalizeKey(lead.email || lead.lead);
          const key = emailKey || lead.id;

          let interested = [];
          try {
            interested = emails.filter((e) =>
              isInterestedReply(e, opts.aiInterestThreshold)
            );
          } catch (e) {
            console.warn("Failed filtering interested emails for lead", {
              leadEmail: lead && (lead.email || lead.lead),
              error: e && e.message,
            });
            interested = [];
          }

          if (!interested.length) continue;

          // —————— process each email, *waiting* for true ——————
          for (const email of interested) {
            if (this.errorOccurred) break;
            if (state.totalEmailsCollected >= opts.maxEmails) {
              state.stop();
              break;
            }

            // Per-email message-id dedup removed; rely solely on lead email/id key

            // Skip very long emails (>500 words) and mark as processed to avoid future repeats
            const emailBodyText = (email && email.body && email.body.text) || (lead && lead.payload && lead.payload.text) || "";
            const wordCount = typeof emailBodyText === "string"
              ? emailBodyText.trim().split(/\s+/).filter(Boolean).length
              : 0;
            if (wordCount > 500) {
              console.log(`[skip] email body too long (${wordCount} words), marking processed.`);
              if (key) {
                await markProcessed(key, redisClient, dedupKey, seen);
              }
              continue;
            }

            let row;
            try {
              row = await mapToSheetRow({
                lead,
                email,
                setErrorOccurred: this.setErrorOccurred.bind(this),
              });
            } catch (e) {
              console.warn("mapToSheetRow failed", {
                leadEmail: lead && (lead.email || lead.lead),
                error: e && e.message,
              });
              // Mark as processed so we do not retry this lead/email again
              try {
                if (key) {
                  await markProcessed(key, redisClient, dedupKey, seen);
                }
              } catch (markErr) {
                console.warn("Failed to mark as processed after mapToSheetRow error", markErr && markErr.message);
              }
              continue;
            }
            // const row = await mapToSheetRow(lead, email);

            // wait until processEmailRow returns true
            let processed = false;
            let attempts = 0;
            const MAX_RETRIES = 3;

            do {
              try {
                processed = await this.processEmailRow({
                  emailRow: row,
                  sheetName,
                });
              } catch (e) {
                console.warn("processEmailRow threw", {
                  leadEmail: lead && (lead.email || lead.lead),
                  error: e && e.message,
                });
                processed = false;
              }
              attempts++;
              if (!processed && attempts < MAX_RETRIES) {
                // optional backoff before retry
                await new Promise((r) => setTimeout(r, 500 * attempts));
              }
            } while (!processed && attempts < MAX_RETRIES);

            if (processed) {
              state.collect(row, true);
              state.totalInterestedLLM = this.totalEnterestedLLM;
              state.totalEncoded = this.totalEncoded;
              emitProgress(state);
              // Mark as processed only after success
              if (key) {
                await markProcessed(key, redisClient, dedupKey, seen);
              }
            } else {
              console.warn(
                `Failed to process row after ${attempts} attempts:`,
                row
              );
            }
          }

          if (state.stoppedEarly) break;
        }

        // Early exit if error flag triggered mid-loop
        if (this.errorOccurred) {
          state.stop();
          state.errorMessage = "Processing aborted due to error.";
          state.stoppedEarly = true;
          emitProgress(state);

          const summary = summarizeState(state);
          await loggerController.addNewLog(summary);
          return responseReturn(res, 500, summary);
        }
      }

      // Normal finish
      emitProgress(state);
      const summary = summarizeState(state);
      await loggerController.addNewLog(summary);

      return responseReturn(res, 200, summary);
    } catch (err) {
      return handleError(err, res);
    }
  };
}

module.exports = new instantlyAiController();
