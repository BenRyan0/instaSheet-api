const con = require("../db/db");
const { responseReturn } = require("../utils/response");

class loggerController {
  // logController.js
  addNewLog = async (logData) => {
    try {
      const insertQuery = `
      INSERT INTO encoding_runs (
        total_processed,
        pages_fetched,
        processed_leads,
        distinct_leads_checked,
        interested_lead_count,
        stopped_early,
        max_emails_cap,
        max_pages_cap,
        ai_interest_threshold,
        total_encoded
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
    `;

      const values = [
        logData.total,
        logData.pagesFetched,
        logData.processedLeads,
        logData.distinctLeadsChecked,
        logData.interestedLeadCount,
        logData.stoppedEarly,
        logData.maxEmailsCap,
        logData.maxPagesCap,
        logData.aiInterestThreshold,
        logData.totalEncoded,
      ];

      const result = await con.query(insertQuery, values);
      return result.rows[0].id;
    } catch (err) {
      console.error("DB Insert Error:", err.message || err);
      throw err;
    }
  };
  getAllLogs = async (req, res) => {
    console.log("GET ALL LOGS");
    try {
      const query = `
      SELECT 
        id,
        total_processed,
        pages_fetched,
        processed_leads,
        distinct_leads_checked,
        interested_lead_count,
        stopped_early,
        max_emails_cap,
        max_pages_cap,
        ai_interest_threshold,
        total_encoded,
        created_at
      FROM encoding_runs
      ORDER BY created_at DESC
    `;

      const result = await con.query(query);
      //   console.log(result);
      responseReturn(res, 200, { logs: result.rows });
    } catch (err) {
      console.error("DB Fetch Error:", err);
      responseReturn(res, 500, { error: "Failed to fetch logs" });
    }
  };
}

module.exports = new loggerController();
