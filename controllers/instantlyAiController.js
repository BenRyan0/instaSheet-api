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
const { extractReply } = require("../services/emailParserService");

const { getIO } = require("../socket");
const pLimit = require("p-limit").default;
const redis = require("redis");
const redisClient = redis.createClient();

// Proper Redis client initialization
redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

redisClient.on("ready", () => {
  console.log("Redis client is ready and connected.");
});

redisClient
  .connect()
  .then(() => {
    console.log("Redis client connected.");
  })
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
  });

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

  getInterestedRepliesOnly_ = async (req, res) => {
    try {
      const { campaignId, opts = {}, sheetName } = req.body;
      const {
        pageLimit,
        emailsPerLead,
        concurrency,
        maxEmails,
        maxPages,
        aiInterestThreshold,
      } = opts;

      const apiKey = process.env.INSTANTLY_API_KEY;
      if (!apiKey) throw new Error("apiKey is required");
      if (!campaignId) throw new Error("campaignId is required");

      const redisKey = `insta:processed_emails:${campaignId}`;
      const cachedEmails = new Set(await redisClient.sMembers(redisKey));

      const authHeaders = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      };

      // ---------- Helpers ----------
      const normalizeLeadsArray = (resp) =>
        resp?.items ||
        resp?.data?.items ||
        resp?.data ||
        resp?.results ||
        resp ||
        [];

      const mapToSheetRow = async ({ lead, email }) => {
        const payload = lead?.payload || {};
        const leadEmail = lead?.email || lead?.lead || email?.lead || "";
        const emailBodyText = email?.body?.text || "";
        const emailBodyHtml = email?.body?.html || "";

        // Use AI-powered extraction
        const extracted = await extractReply(
          emailBodyText || emailBodyHtml || ""
        );

        const emailSignature = extracted.reply
          ? extracted.reply
              .split(/\r?\n\r?\n/)
              .slice(-2)
              .join("\n\n")
          : "";

        const phoneFromEmailMatch = (extracted.reply || "").match(
          /(\+?\d{1,3}[-.\s]?)?(\(\d{2,4}\)|\d{2,4})[-.\s]?\d{3,4}[-.\s]?\d{3,4}/
        );

        const phoneFromEmail = phoneFromEmailMatch
          ? phoneFromEmailMatch[0]
          : "";

        console.log(
          colorize("Extracted Email Content", "cyan"),
          extracted.reply
        );
        return {
          Agent: process.env.AGENT_NAME || "instaSheet agent",
          "For scheduling": "",
          "sales person": extracted.salesPerson || "",
          "sales person email": extracted.salesPersonEmail || "",
          company: lead?.company_name || lead?.company || "",
          "company phone#": lead?.phone || "",
          "phone#from email": phoneFromEmail,
          "lead first name": lead?.first_name || "",
          "lead last name": lead?.last_name || "",
          "lead email": leadEmail,
          "Column 1": leadEmail,
          "email reply": extracted.reply || "",
          "phone 1": lead?.phone || "",
          phone2: payload.phone2 || "",
          address: payload.address || lead?.address || "",
          city: payload.city || lead?.city || "",
          state: payload.state || lead?.state || "",
          zip: payload.zip || "",
          details: payload.details || lead?.details || lead?.website || "",
          "Email Signature": extracted.signature || emailSignature || "",
          _email_id: email?.id || email?.message_id || "",
          _lead_id: lead?.id || lead?.lead_id || "",
          _thread_id: email?.thread_id || "",
          _timestamp_email:
            email?.timestamp_email || email?.timestamp_created || "",
        };
      };

      const isInterestedReply = (email) => {
        if (!email) return false;
        if (email.i_status === 1) return true;
        if (email.ai_interest_value >= aiInterestThreshold) return true;
        return email.email_type === "received" || email.ue_type === 2;
      };

      const getNextCursor = (resp) =>
        resp?.next_starting_after ||
        resp?.data?.next_starting_after ||
        resp?.paging?.next_cursor ||
        resp?.pagination?.next_starting_after ||
        null;

      // ---------- API Calls ----------
      const fetchLeadsPage = async (cursor = null) => {
        const FILTER_LEAD_INTERESTED = {
          lt_interest_status: 1, // interest status = “interested”
          email_reply_count: { gt: 0 }, // at least one reply
          ai_interest_value: { gte: aiInterestThreshold }, // AI score ≥ threshold
        };
        const body = {
          filters: {
            campaign: campaignId,
            lt_interest_status: 1,
            email_reply_count: { gt: 0 },
            ai_interest_value: { gte: aiInterestThreshold },
            ...FILTER_LEAD_INTERESTED,
          },
          limit: pageLimit,
          ...(cursor && { starting_after: cursor }),
        };
        return (
          await axios.post(`${API_BASE}${LEADS_LIST_PATH}`, body, {
            headers: authHeaders,
          })
        ).data;
      };

      const fetchRepliesForLeadsBatch = async (
        leads,
        perLeadLimit,
        concurrency
      ) => {
        const limit = pLimit(concurrency);

        const fetchRepliesForLead = async (lead) => {
          const params = {
            campaign_id: campaignId,
            email_type: "received",
            sort_order: "desc",
            i_status: 1,
            is_unread: true,
            limit: perLeadLimit,
            ...(lead?.id
              ? { lead_id: lead.id }
              : { lead: lead?.email || lead?.lead }),
          };

          try {
            const r = await axios.get(`${API_BASE}${EMAILS_PATH}`, {
              headers: authHeaders,
              params,
            });
            return { lead, emails: normalizeLeadsArray(r.data) };
          } catch (err) {
            return { lead, emails: [], error: err.message };
          }
        };

        return await Promise.all(
          leads.map((lead) => limit(() => fetchRepliesForLead(lead)))
        );
      };

      const io = getIO();
      const self = this;

      // ---------- State ----------
      const rows = [];
      const emailsAll = new Set(cachedEmails);
      const interestedLeadIds = new Set();
      let totalEmailsCollected = 0,
        pagesFetched = 0,
        processedLeads = 0;
      let cursor = null,
        stoppedEarly = false;

      function emitProgress() {
        if (!io) return;
        const now = new Date();
        const timeString =
          now.getHours().toString().padStart(2, "0") +
          ":" +
          now.getMinutes().toString().padStart(2, "0") +
          ":" +
          now.getSeconds().toString().padStart(2, "0");
        io.emit("progress", {
          pagesFetched,
          processedLeads,
          totalEmailsCollected,
          rowsSoFar: rows.length,
          distinctLeadsChecked: emailsAll.size,
          interestedLeadCount: interestedLeadIds.size,
          stoppedEarly,
          maxEmailsCap: maxEmails,
          maxPagesCap: maxPages,
          aiInterestThreshold,
          percentComplete: Math.min(
            100,
            Math.round((totalEmailsCollected / maxEmails) * 100)
          ),
          date: timeString,
          totalEncoded: self.totalEncoded,
          isInterestedLLM: self.totalEnterestedLLM,
        });
      }

      console.log(
        `[interested-only] Start: campaign=${campaignId}, maxPages=${maxPages}, sheetName=${sheetName}`
      );

      // ---------- Main Loop ----------
      while (
        !stoppedEarly &&
        totalEmailsCollected < maxEmails &&
        pagesFetched < maxPages
      ) {
        const pageResp = await fetchLeadsPage(cursor);
        const leads = normalizeLeadsArray(pageResp);
        pagesFetched++;

        if (!leads.length) break;
        console.log(
          `[interested-only] Page ${pagesFetched} — leads: ${leads.length}`
        );

        for (let i = 0; i < leads.length && !stoppedEarly; i += concurrency) {
          // 1️ Filter batch by emailKey
          const batch = leads.slice(i, i + concurrency).filter((lead) => {
            // derive the canonical email key
            const emailKey = lead?.email?.toLowerCase().trim();
            if (!emailKey) {
              console.log(
                `[skip] no valid email for lead: ${JSON.stringify(lead)}`
              );
              return false;
            }
            if (emailsAll.has(emailKey)) {
              console.log(`[skip] already processed email: ${emailKey}`);
              return false;
            }
            console.log(`[process] new email to fetch replies: ${emailKey}`);
            return true;
          });

          console.log(
            "Fetched lead emails in batch:",
            batch.map((l) => l.email)
          );

          const remaining = maxEmails - totalEmailsCollected;
          if (remaining <= 0) {
            stoppedEarly = true;
            break;
          }

          const perLeadLimit = Math.min(emailsPerLead, remaining);
          const batchResults = await fetchRepliesForLeadsBatch(
            batch,
            perLeadLimit,
            concurrency
          );

          for (const r of batchResults) {
            const lead = r.value?.lead || r.lead;
            const emailKey = lead?.email?.toLowerCase().trim();
            if (!emailKey) continue;

            // Persist and log add vs duplicate
            if (!emailsAll.has(emailKey)) {
              console.log(
                `[add] persisting email for the first time: ${emailKey}`
              );
              emailsAll.add(emailKey);
              await redisClient.sAdd(redisKey, emailKey);
            } else {
              console.log(`[already added] email seen again: ${emailKey}`);
            }

            if (r.error) continue;

            const interestedReplies = (
              r.value?.emails ||
              r.emails ||
              []
            ).filter(isInterestedReply);
            if (!interestedReplies.length) continue;

            interestedLeadIds.add(emailKey);

            for (const email of interestedReplies) {
              if (totalEmailsCollected >= maxEmails) {
                stoppedEarly = true;
                break;
              }

              const row = await mapToSheetRow({ lead, email });
              if (await this.processEmailRow({ emailRow: row, sheetName })) {
                rows.push(row);
                totalEmailsCollected++;
                emitProgress();
              }
            }

            processedLeads++;
            if (
              processedLeads % 25 === 0 ||
              totalEmailsCollected >= maxEmails
            ) {
              console.log(
                `[interested-only] Progress: leads=${processedLeads}, pages=${pagesFetched}, collected=${totalEmailsCollected}/${maxEmails}`
              );
            }
          }
        }

        if (totalEmailsCollected >= maxEmails) stoppedEarly = true;
        emitProgress();

        cursor = getNextCursor(pageResp);
        if (!cursor) break;
      }

      console.log(
        `[interested-only] Done: pages=${pagesFetched}, leads=${emailsAll.size}, rows=${rows.length}, stoppedEarly=${stoppedEarly}`
      );

      // Final progress emit
      emitProgress();

      return responseReturn(res, 200, {
        total: rows.length,
        rows,
        pagesFetched,
        distinctLeadsChecked: emailsAll.size,
        interestedLeadCount: interestedLeadIds.size,
        stoppedEarly,
        maxEmailsCap: maxEmails,
        maxPagesCap: maxPages,
        aiInterestThreshold,
      });
    } catch (err) {
      console.error("[interested-only] Error:", err);
      return responseReturn(res, 500, {
        error: "Failed to fetch interested reply emails",
        detail: err?.message || String(err),
      });
    }
  };
}

module.exports = new instantlyAiController();
