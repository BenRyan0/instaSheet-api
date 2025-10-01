const { responseReturn } = require("../utils/response");
require("dotenv").config({ silent: true });
const axios = require("axios");
const BASE_URL = "https://api.instantly.ai/api/v2/campaigns";
const PAGE_SIZE = 10;
const API_BASE = "https://api.instantly.ai";
const LEADS_LIST_PATH = "/api/v2/leads/list";
const EMAILS_PATH = "/api/v2/emails";
const { colorize } = require("../utils/colorLogger");
const {
  normalizeRow,
  isAddressUsBased,
  isWebsiteUsBased,
  isActuallyInterested,
  encodeToSheet,
} = require("../services/leadServices");

const pLimit = require("p-limit").default;
const redisClient = require("../config/redisClient");
const { emitProgress } = require("../events/progressEmitter");
const { normalizeLeadsArray } = require("../utils/leads");
// const {  } = require("../utils/leads");
const { mapToSheetRow } = require("../mappers/sheetRow");

const { validateOpts } = require("../utils/validators");
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
const { HttpError, handleError } = require("../services/errorService");

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
    try {
      const { campaignId, opts, sheetName } = req.body;
      console.log(opts)
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

      return responseReturn(res, 200, summarizeState(state));
    } catch (err) {
      return handleError(err, res);
    }
  };

  // getInterestedRepliesOnly_ = async (req, res) => {
  //   try {
  //     const { campaignId, opts, sheetName } = req.body;

  //     validateOpts(opts);
  //     const authHeaders = getAuthHeaders(process.env.INSTANTLY_API_KEY);
  //     // if (!apiKey) throw new Error("apiKey is required");
  //     // if (!campaignId) throw new Error("campaignId is required");

  //     const redisKey = `insta:processed_emails:${campaignId}`;
  //     const cachedEmails = await redisClient.sMembers(redisKey);

  //     const isInterestedReply = (email) => {
  //       if (!email) return false;
  //       if (email.i_status === 1) return true;
  //       if (email.ai_interest_value >= aiInterestThreshold) return true;
  //       return email.email_type === "received" || email.ue_type === 2;
  //     };

  //     // ---------- API Calls ----------
  //     const fetchLeadsPage = async (cursor = null) => {
  //       const FILTER_LEAD_INTERESTED = {
  //         lt_interest_status: 1, // interest status = “interested”
  //         email_reply_count: { gt: 0 }, // at least one reply
  //         ai_interest_value: { gte: aiInterestThreshold }, // AI score ≥ threshold
  //       };
  //       const body = {
  //         filters: {
  //           campaign: campaignId,
  //           lt_interest_status: 1,
  //           email_reply_count: { gt: 0 },
  //           ai_interest_value: { gte: aiInterestThreshold },
  //           ...FILTER_LEAD_INTERESTED,
  //         },
  //         limit: pageLimit,
  //         ...(cursor && { starting_after: cursor }),
  //       };
  //       return (
  //         await axios.post(`${API_BASE}${LEADS_LIST_PATH}`, body, {
  //           headers: authHeaders,
  //         })
  //       ).data;
  //     };

  //     const fetchRepliesForLeadsBatch = async (
  //       leads,
  //       perLeadLimit,
  //       concurrency
  //     ) => {
  //       const limit = pLimit(concurrency);

  //       const fetchRepliesForLead = async (lead) => {
  //         const params = {
  //           campaign_id: campaignId,
  //           email_type: "received",
  //           sort_order: "desc",
  //           i_status: 1,
  //           is_unread: true,
  //           limit: perLeadLimit,
  //           ...(lead?.id
  //             ? { lead_id: lead.id }
  //             : { lead: lead?.email || lead?.lead }),
  //         };

  //         try {
  //           const r = await axios.get(`${API_BASE}${EMAILS_PATH}`, {
  //             headers: authHeaders,
  //             params,
  //           });
  //           return { lead, emails: normalizeLeadsArray(r.data) };
  //         } catch (err) {
  //           return { lead, emails: [], error: err.message };
  //         }
  //       };

  //       return await Promise.all(
  //         leads.map((lead) => limit(() => fetchRepliesForLead(lead)))
  //       );
  //     };

  //     // ---------- State ----------
  //     const rows = [];
  //     const emailsAll = new Set(cachedEmails);
  //     const interestedLeadIds = new Set();
  //     let totalEmailsCollected = 0,
  //       pagesFetched = 0,
  //       processedLeads = 0;
  //     let cursor = null,
  //       stoppedEarly = false;

  //     emitProgress({
  //       pagesFetched,
  //       processedLeads,
  //       totalEmailsCollected,
  //       rowsSoFar: rows.length,
  //       distinctLeadsChecked: emailsAll.size,
  //       interestedLeadCount: interestedLeadIds.size,
  //       stoppedEarly,
  //       maxEmailsCap: maxEmails,
  //       maxPagesCap: maxPages,
  //       aiInterestThreshold,
  //       totalEncoded: this.totalEncoded,
  //       totalInterestedLLM: this.totalEnterestedLLM,
  //     });

  //     console.log(
  //       `[interested-only] Start: campaign=${campaignId}, maxPages=${maxPages}, sheetName=${sheetName}`
  //     );

  //     // ---------- Main Loop ----------
  //     while (
  //       !stoppedEarly &&
  //       totalEmailsCollected < maxEmails &&
  //       pagesFetched < maxPages
  //     ) {
  //       const pageResp = await fetchLeadsPage(cursor);
  //       const leads = normalizeLeadsArray(pageResp);
  //       pagesFetched++;

  //       if (!leads.length) break;
  //       console.log(
  //         `[interested-only] Page ${pagesFetched} — leads: ${leads.length}`
  //       );

  //       for (let i = 0; i < leads.length && !stoppedEarly; i += concurrency) {
  //         // 1️ Filter batch by emailKey
  //         const batch = leads.slice(i, i + concurrency).filter((lead) => {
  //           // derive the canonical email key
  //           const emailKey = lead?.email?.toLowerCase().trim();
  //           if (!emailKey) {
  //             console.log(
  //               `[skip] no valid email for lead: ${JSON.stringify(lead)}`
  //             );
  //             return false;
  //           }
  //           if (emailsAll.has(emailKey)) {
  //             console.log(`[skip] already processed email: ${emailKey}`);
  //             return false;
  //           }
  //           console.log(`[process] new email to fetch replies: ${emailKey}`);
  //           return true;
  //         });

  //         console.log(
  //           "Fetched lead emails in batch:",
  //           batch.map((l) => l.email)
  //         );

  //         const remaining = maxEmails - totalEmailsCollected;
  //         if (remaining <= 0) {
  //           stoppedEarly = true;
  //           break;
  //         }

  //         const perLeadLimit = Math.min(emailsPerLead, remaining);
  //         const batchResults = await fetchRepliesForLeadsBatch(
  //           batch,
  //           perLeadLimit,
  //           concurrency
  //         );

  //         for (const r of batchResults) {
  //           const lead = r.value?.lead || r.lead;
  //           const emailKey = lead?.email?.toLowerCase().trim();
  //           if (!emailKey) continue;

  //           // Persist and log add vs duplicate
  //           if (!emailsAll.has(emailKey)) {
  //             console.log(
  //               `[add] persisting email for the first time: ${emailKey}`
  //             );
  //             emailsAll.add(emailKey);
  //             await redisClient.sAdd(redisKey, emailKey);
  //           } else {
  //             console.log(`[already added] email seen again: ${emailKey}`);
  //           }

  //           if (r.error) continue;

  //           const interestedReplies = (
  //             r.value?.emails ||
  //             r.emails ||
  //             []
  //           ).filter(isInterestedReply);
  //           if (!interestedReplies.length) continue;

  //           interestedLeadIds.add(emailKey);

  //           for (const email of interestedReplies) {
  //             if (totalEmailsCollected >= maxEmails) {
  //               stoppedEarly = true;
  //               break;
  //             }

  //             const row = await mapToSheetRow(lead, email);
  //             if (await this.processEmailRow({ emailRow: row, sheetName })) {
  //               rows.push(row);
  //               totalEmailsCollected++;
  //               emitProgress({
  //                 pagesFetched,
  //                 processedLeads,
  //                 totalEmailsCollected,
  //                 rowsSoFar: rows.length,
  //                 distinctLeadsChecked: emailsAll.size,
  //                 interestedLeadCount: interestedLeadIds.size,
  //                 stoppedEarly,
  //                 maxEmailsCap: maxEmails,
  //                 maxPagesCap: maxPages,
  //                 aiInterestThreshold,
  //                 totalEncoded: this.totalEncoded,
  //                 totalInterestedLLM: this.totalEnterestedLLM,
  //               });
  //             }
  //           }
  //           processedLeads++;
  //           if (
  //             processedLeads % 25 === 0 ||
  //             totalEmailsCollected >= maxEmails
  //           ) {
  //             console.log(
  //               `[interested-only] Progress: leads=${processedLeads}, pages=${pagesFetched}, collected=${totalEmailsCollected}/${maxEmails}`
  //             );
  //           }
  //         }
  //       }

  //       if (totalEmailsCollected >= maxEmails) stoppedEarly = true;
  //       emitProgress({
  //         pagesFetched,
  //         processedLeads,
  //         totalEmailsCollected,
  //         rowsSoFar: rows.length,
  //         distinctLeadsChecked: emailsAll.size,
  //         interestedLeadCount: interestedLeadIds.size,
  //         stoppedEarly,
  //         maxEmailsCap: maxEmails,
  //         maxPagesCap: maxPages,
  //         aiInterestThreshold,
  //         totalEncoded: this.totalEncoded,
  //         totalInterestedLLM: this.totalEnterestedLLM,
  //       });

  //       cursor = getNextCursor(pageResp);
  //       if (!cursor) break;
  //     }

  //     console.log(
  //       `[interested-only] Done: pages=${pagesFetched}, leads=${emailsAll.size}, rows=${rows.length}, stoppedEarly=${stoppedEarly}`
  //     );

  //     // Final progress emit
  //     emitProgress({
  //       pagesFetched,
  //       processedLeads,
  //       totalEmailsCollected,
  //       rowsSoFar: rows.length,
  //       distinctLeadsChecked: emailsAll.size,
  //       interestedLeadCount: interestedLeadIds.size,
  //       stoppedEarly,
  //       maxEmailsCap: maxEmails,
  //       maxPagesCap: maxPages,
  //       aiInterestThreshold,
  //       totalEncoded: this.totalEncoded,
  //       totalInterestedLLM: this.totalEnterestedLLM,
  //     });

  //     return responseReturn(res, 200, {
  //       total: rows.length,
  //       rows,
  //       pagesFetched,
  //       distinctLeadsChecked: emailsAll.size,
  //       interestedLeadCount: interestedLeadIds.size,
  //       stoppedEarly,
  //       maxEmailsCap: maxEmails,
  //       maxPagesCap: maxPages,
  //       aiInterestThreshold,
  //     });
  //   } catch (err) {
  //     console.error("[interested-only] Error:", err);
  //     return responseReturn(res, 500, {
  //       error: "Failed to fetch interested reply emails",
  //       detail: err?.message || String(err),
  //     });
  //   }
  // };
}

module.exports = new instantlyAiController();
