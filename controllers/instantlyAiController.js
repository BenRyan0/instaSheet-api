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
const { fetchRepliesForLeadsBatch } = require("../services/emailService");
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

  // Setter for totalEncoded (overwrites)
  setTotalEncoded(val) {
    this.totalEncoded = val;
  }
  setTotalEnterestedLLM(val) {
    this.totalEnterestedLLM = val;
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
        });
        if (!usAddress) return true; // Skip but still return true

        const interested = await isActuallyInterested(
          rowJson["email reply"],
          this.addTotalEnterestedLLM.bind(this)
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
          this.addTotalEnterestedLLM.bind(this)
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

  getInterestedRepliesOnly_ = async (req, res) => {
    var i = 0;
    try {
      const { campaignId, opts, sheetName } = req.body;
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
      while (shouldContinue(state)) {
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

        const batch = filterNewLeads(leads, seen);
        if (batch.length === 0) continue;

        const results = await fetchRepliesForLeadsBatch(batch, {
          campaignId,
          perLeadLimit: opts.emailsPerLead,
          concurrency: opts.concurrency,
          authHeaders,
        });
        for (const { lead, emails } of results) {
          state.nextLead();
          i++;
          emitProgress(state);

          console.log("i", i);
          const key = normalizeKey(lead.email);
          const wasNew = await markProcessed(key, redisClient, dedupKey, seen);
          if (!wasNew) continue;

          const interested = emails.filter((e) =>
            isInterestedReply(e, opts.aiInterestThreshold)
          );

          if (!interested.length) continue;

          // —————— process each email, *waiting* for true ——————
          for (const email of interested) {
            if (state.totalEmailsCollected >= opts.maxEmails) {
              state.stop();
              break;
            }

            const row = await mapToSheetRow(lead, email);

            // wait until processEmailRow returns true
            let processed = false;
            let attempts = 0;
            const MAX_RETRIES = 3;

            do {
              processed = await this.processEmailRow({
                emailRow: row,
                sheetName,
              });
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
            } else {
              console.warn(
                `Failed to process row after ${attempts} attempts:`,
                row
              );
            }
          }

          if (state.stoppedEarly) break;
        }
      }
      emitProgress(state);

      const summary = summarizeState(state);

      // logs the data into database before sending res to frontend
      await loggerController.addNewLog(summary);


      return responseReturn(res, 200, summarizeState(state));
    } catch (err) {
      return handleError(err, res);
    }
  };
}

module.exports = new instantlyAiController();
