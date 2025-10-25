require("dotenv").config({ silent: true });
const { getAuthHeaders } = require("../../utils/auth");
const redisClient = require("../../config/redisClient");
const {
  fetchLeadsPageWebhook,
} = require("../../services/instantly/lead/fetchService");
const {
  normalizeLeadsArray,
} = require("../../services/instantly/lead/normalizeService");
const { fetchRepliesForLead } = require("../../services/emailService");
const {
  filterNewLeads,
  normalizeKey,
  markProcessed,
} = require("../../services/dedupService");

const { isInterestedReply } = require("../../utils/filters");
const { mapToSheetRow } = require("../../mappers/sheetRow");
const { processEmailRow } = require("../../services/email/emailProcessing");

class webhookController {
  totalEncoded = 0;
  totalToBeApproved = 0;
  totalEnterestedLLM = 0;
  errorOccurred = false;
  errorContext = "";

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

  // LEAD PROCESSING FROM WEB HOOK
  async encodeInterestedRepliesByWebhook({ opts, sheetName }) {
    try {
      const authHeaders = getAuthHeaders(process.env.INSTANTLY_API_KEY);

      // redis database de duplication key and checkin
      const dedupKey = `insta:processed_emails`;
      const seenMembers = await redisClient.sMembers(dedupKey);
      const seen = new Set(seenMembers);

      let emptyBatchCount = 0;
      let errorOccurred = false;

      // Checking for eerrors before continueing
      while (!errorOccurred) {
        // Fetches the unprocessed leads from PG database
        const page = await fetchLeadsPageWebhook({
          pageLimit: opts.pageLimit,
          authHeaders,
          setErrorOccurred: this.setErrorOccurred.bind(this),
          setErrorContext: this.setErrorContext.bind(this),
        });

        // Normalization of the data
        const leads = normalizeLeadsArray(page);

        // Filtering if leads is New(EMAIL NOT STORED IN REDIS DATABASE)
        const batch = filterNewLeads(leads, seen);

        console.log("Batch:", batch.length);

        if (batch.length === 0) {
          emptyBatchCount++;
          console.log(`No new leads found (${emptyBatchCount}/3)...`);

          if (emptyBatchCount >= 3) {
            console.log(
              "No new leads for 3 consecutive checks. Stopping loop."
            );
            break;
          }

          // Optional: small delay before retrying
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        // Reset count if batch has data
        emptyBatchCount = 0;

        // FETCHING THE EMAIL REPLY OF EACH LEADS
        for (const lead of batch) {
          const result = await fetchRepliesForLead(lead, {
            perLeadLimit: opts.emailsPerLead,
            authHeaders,
            delayMs: opts.delayMs,
            setErrorOccurred: this.setErrorOccurred.bind(this),
            setErrorContext: this.setErrorContext.bind(this),
          });

          // CHECKING IF THHE FETCHING THE EMAIL REPLY OF EACH LEADS HAD PROBLEMS (REPLY HAS NO CONTENTS)
          if (result.error || result.skipped) {
            // Marking the lead email as processed
            const key = normalizeKey(lead.email || lead.id);
            if (key) await markProcessed(key, redisClient, dedupKey, seen);
            continue;
          }

          // CHECKING IF THE EMAIL IS INTERESTED BUT BAISED ONLY BY aiInterest RATING
          const interestedEmails = result.emails.filter((e) =>
            isInterestedReply(e, opts.aiInterestThreshold)
          );

          // IF NOT INTERESTED BASED ON aiInterest SKIP
          if (!interestedEmails.length) continue;

          // PROCESSING EACH EMAIL OF ALL THE INTERESTED EMAILS
          for (const email of interestedEmails) {
            // REDIS KEY
            const emailKey = normalizeKey(lead.email || lead.id);
            const key = emailKey || lead.id;

            // Getting the email's timestamp
            const emailTimestamp = new Date(
              email?.timestamp_email || Date.now()
            );

            // if email's timestamp is more than 14 days...lead's email skipped
            const age = Date.now() - emailTimestamp.getTime();
            if (age > 30 * 24 * 60 * 60 * 1000) continue;

            // if the overall text of the lead's email reply is more than 500 words... skip
            // if more than 500 its full of html which is mostly promotional
            const emailBodyText = email.body?.text || "";
            const wordCount = emailBodyText.split(/\s+/).filter(Boolean).length;
            if (wordCount > 500) continue;

            let row;

            // Mapping every values of the lead and email into one
            try {
              row = await mapToSheetRow({
                lead,
                email,
                setErrorOccurred: this.setErrorOccurred.bind(this),
                setErrorContext: this.setErrorContext.bind(this),
              });
            } catch (e) {
              console.warn("mapToSheetRow failed:", e.message);
              if (key) await markProcessed(key, redisClient, dedupKey, seen);
              continue;
            }

            let processed = false;
            let attempts = 0;
            while (!processed && attempts < 3) {
              attempts++;
              try {
                processed = await processEmailRow({
                  emailRow: row,
                  sheetName,
                  additionalContext: {
                    ClientID: lead.id || "N/A",
                    Category: lead.category || "Uncategorized",
                    TimeStamp:
                      email.timestamp_email || new Date().toISOString(),
                  },
                  addToTotalEncoded: this.addToTotalEncoded.bind(this),
                  setErrorOccurred: this.setErrorOccurred.bind(this),
                  setErrorContext: this.setErrorContext.bind(this),
                  addTotalToBeApproved: this.addTotalToBeApproved.bind(this),
                });
              } catch (err) {
                console.warn(
                  `processEmailRow failed (try ${attempts})`,
                  err.message
                );
                await new Promise((r) => setTimeout(r, 500 * attempts));
              }
            }

            if (processed) {
              if (key) await markProcessed(key, redisClient, dedupKey, seen);
            }
          }
        }

        if (errorOccurred) {
          console.log("Error occurred mid-loop");
          if (this.errorContext) {
            console.log("!!!-------------- ERROR CONTEXT --------------!!!");
            console.log(this.errorContext);
            console.log("!!!-------------- ERROR CONTEXT --------------!!!");
          }
          break;
        }
      }

      // await incrementFetchedInterestedLead();
      console.log("Interested Lead -DONE:");
      return true;
    } catch (err) {
      console.error("Fatal error in encodeInterestedRepliesByWebhook:", err);
      return { error: true, message: err.message };
    }
  }
}

module.exports = new webhookController();
