const con = require("../db/db");
const { responseReturn } = require("../utils/response");

class loggerController {
  // logController.js

  addNewLog = async (logData) => {
      console.log("logData")
      console.log(logData)
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
        total_encoded,
        error_context,
        total_tobe_approved
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
        logData.errorContext || "",
        logData.totalToBeApproved || 0,
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
         total_tobe_approved,
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

  getAllTobeEncodedLeads = async (req, res) => {
    console.log("GET ALL TO BE ENCODED LEADS");
    try {
      const query = `
     SELECT *
      FROM toBeEncodedLeads
      WHERE isDone = FALSE
      ORDER BY created_at DESC;
    `;

      const result = await con.query(query);
      //   console.log(result);
      responseReturn(res, 200, { toBeEncodedLeads: result.rows });
    } catch (err) {
      console.error("DB Fetch Error:", err);
      responseReturn(res, 500, { error: "Failed to fetch logs" });
    }
  };
}

module.exports = new loggerController();
