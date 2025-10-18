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
const { fetchRepliesForLead } = require("../services/emailService");
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
  totalToBeApproved = 0;
  totalEnterestedLLM = 0;
  errorOccurred = false;
  errorContext = "";
  encodingCurrentProgress = "";

  // Setter for totalEncoded (overwrites)
  setTotalEncoded(val) {
    this.totalEncoded = val;
  }
  setTotalToBeApproved(val) {
    this.totalToBeApproved = val;
  }
  setTotalEnterestedLLM(val) {
    this.totalEnterestedLLM = val;
  }
  setErrorOccurred(val) {
    this.errorOccurred = val;
  }

  setErrorContext(val) {
    this.errorContext = val;
  }
  setEncodingCurrentProgress(val) {
    this.encodingCurrentProgress = val;
  }

  // Increment totalEncoded by a value (additive, does not reset)
  addToTotalEncoded(val) {
    this.totalEncoded += val;
  }
  addTotalEnterestedLLM(val) {
    this.totalEnterestedLLM += val;
  }
  addTotalToBeApproved(val) {
    this.totalToBeApproved += val;
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

  async processEmailRow({
    emailRow,
    sheetName,
    additionalContext,
    setErrorOccurred,
    setErrorContext,
    addToTotalEncoded,
    addTotalToBeApproved,
  }) {
    console.log(colorize("Processing lead Email ...", "blue"));
    console.log("additionalContext");
    console.log(additionalContext);
    const spreadsheetId = process.env.SPREADSHEET_ID;
    try {
      const rowJson = await normalizeRow(emailRow);
      // --- Step 1: Address present? ---
      if (
        rowJson.address ||
        rowJson.city ||
        rowJson.state ||
        rowJson.zip ||
        rowJson["company phone#"]
      ) {
        const usAddress = await isAddressUsBased({
          city: rowJson.city,
          state: rowJson.state,
          address: rowJson.address,
          zip: rowJson.zip,
          phone: rowJson["company phone#"],
          setErrorOccurred,
          setErrorContext,
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
            additionalContext,
            addToTotalEncoded,
            setErrorOccurred,
            setErrorContext,
            addTotalToBeApproved
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
            additionalContext,
            addToTotalEncoded,
            setErrorOccurred,
            setErrorContext,
            addTotalToBeApproved
          );
        }
        return true; // Continue flow regardless
      }

      return true;
    } catch (err) {
      if (setErrorOccurred) setErrorOccurred(true);
      if (setErrorContext) setErrorContext(err.message);
      console.error("processEmailRow failed:", err.message);
      return true; // Ensure main flow continues even on error
    }
  }

  stopIncodingRun = async (req, res) => {
    try {
      console.log("STOP INCODING RUNS INITIATED");
      this.setErrorOccurred(true);
      this.setErrorContext("Manually stopped by user");

      responseReturn(res, 200, {
        message: "Encoding Runs Successfuly Stopped",
      });
    } catch (error) {
      console.log(error);
      responseReturn(res, 500, {
        message: "Stopping the Encoding runs into error",
      });
    }
  };

  getInterestedRepliesOnly_ = async (req, res) => {
    var i = 0;
    this.errorOccurred = false;
    try {
      const { campaignId, opts, sheetName } = req.body;
      if (!campaignId || Array.isArray(campaignId)) {
        return responseReturn(res, 400, {
          error: "Invalid or missing campaignId (1 campaign Id expected)",
        });
      }

      const authHeaders = getAuthHeaders(process.env.INSTANTLY_API_KEY);

      const dedupKey = `insta:processed_emails:${campaignId}`;
      const seenMembers = await redisClient.sMembers(dedupKey);
      const seen = new Set(seenMembers);

      // State initialization - for progress tracking and logging
      const state = initState({
        initialSeenCount: seen.size,
        maxEmails: opts.maxEmails,
        maxPages: opts.maxPages,
        aiInterestThreshold: opts.aiInterestThreshold,
      });

      // Progress imited (socket.io)
      emitProgress(state);

      let cursor = null;

      // checking if the loop has reached its max limits
      // Checking if error flag was set before starting main loop
      while (shouldContinue(state) && !this.errorOccurred) {
        state.nextPage();

        // GETTING ONE PAGE OF INTERESTED LEADS(will be an array of leads)
        const page = await fetchLeadsPage({
          campaignId,
          cursor,
          pageLimit: opts.pageLimit,
          aiThreshold: opts.aiInterestThreshold,
          authHeaders,
          setErrorOccurred: this.setErrorOccurred.bind(this),
          setErrorContext: this.setErrorContext.bind(this),
        });

        const leads = normalizeLeadsArray(page);
        cursor = getNextCursor(page);

        const batch = filterNewLeads(leads, seen);
        console.log(batch);
        console.log("batch");

        if (batch.length === 0) {
          // console.log("[SKIP] Empty batch, not incrementing page count.");
          continue;
        }

        // Only increment page when we actually have new leads
        // state.nextPage();

        // Sequentially process each lead: wait for replies and email processing before next lead
        for (const lead of batch) {
          const result = await fetchRepliesForLead(lead, {
            campaignId,
            perLeadLimit: opts.emailsPerLead,
            authHeaders,
            delayMs: opts.delayMs,
            setErrorOccurred: this.setErrorOccurred.bind(this),
            setErrorContext: this.setErrorContext.bind(this),
            is_unread: opts.is_unread,
          });

          // Recognize skip or error before proceeding
          if (result.skipped) {
            console.log(
              `[SKIP] Lead skipped (${result.reason}): ${lead.email}`
            );
            // Optionally mark as processed so it's not rechecked next run
            const emailKey = normalizeKey(lead.email || lead.lead);
            const key = emailKey || lead.id;
            if (key) {
              await markProcessed(key, redisClient, dedupKey, seen);
            }
            continue;
          }

          if (result.error) {
            console.warn(
              `[ERROR] Skipping lead due to fetch error: ${lead.email}`,
              result.error
            );
            continue;
          }

          const { emails } = result;

          if (this.errorOccurred) break;
          state.nextLead();
          emitProgress(state);

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
            // Skip emails older than 2 weeks
            const emailTimestamp = email?.timestamp_email
              ? new Date(email.timestamp_email)
              : null;
            const now = new Date();
            const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

            if (emailTimestamp && now - emailTimestamp > TWO_WEEKS_MS) {
              console.log(
                `[skip] Email from ${emailTimestamp.toISOString()} is older than 2 weeks, skipping.`
              );
              if (key) {
                await markProcessed(key, redisClient, dedupKey, seen);
              }
              continue;
            }
            // Per-email message-id dedup removed; rely solely on lead email/id key

            // Skip very long emails (>500 words) and mark as processed to avoid future repeats
            const emailBodyText =
              (email && email.body && email.body.text) ||
              (lead && lead.payload && lead.payload.text) ||
              "";
            const wordCount =
              typeof emailBodyText === "string"
                ? emailBodyText.trim().split(/\s+/).filter(Boolean).length
                : 0;
            if (wordCount > 500) {
              console.log(
                `[skip] email body too long (${wordCount} words), marking processed.`
              );
              if (key) {
                await markProcessed(key, redisClient, dedupKey, seen);
              }
              continue;
            }

            let row;
            let additionalContext = {};
            try {
              // Add contextual info
              // the ClientId and Category to be placed in the tags
              additionalContext = {
                ClientID: lead?.id ?? "N/A",
                TimeStamp: email?.timestamp_email ?? new Date().toISOString(),
                // timestamp_email
                Category:
                  lead?.payload?.category ?? lead?.category ?? "Uncategorized",
              };

              if (
                !email.content_preview ||
                email.content_preview.trim() === ""
              ) {
                console.log(
                  `[skip] Missing content_preview for ${
                    lead.email || lead.lead
                  }`
                );
                // Mark as processed so it won't be retried next time
                if (key) {
                  await markProcessed(key, redisClient, dedupKey, seen);
                }
                continue;
              }

              row = await mapToSheetRow({
                lead,
                email,
                setErrorOccurred: this.setErrorOccurred.bind(this),
                setErrorContext: this.setErrorContext.bind(this),
              });
              console.log("MAP TO SHEET ROW RESULT");
              console.log(row);
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
                console.warn(
                  "Failed to mark as processed after mapToSheetRow error",
                  markErr && markErr.message
                );
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
                  additionalContext,
                  addToTotalEncoded: this.addToTotalEncoded.bind(this),
                  setErrorOccurred: this.setErrorOccurred.bind(this),
                  setErrorContext: this.setErrorContext.bind(this),
                  addTotalToBeApproved: this.addTotalToBeApproved.bind(this),
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
              state.totalToBeApproved = this.totalToBeApproved;
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
          console.log("ERR");
          state.stop();
          state.errorContext = this.errorContext;
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
