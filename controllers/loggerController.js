const con = require("../db/db");
const { responseReturn } = require("../utils/response");

class loggerController {
  // logController.js

  addNewLog = async (logData) => {
    console.log("logData");
    console.log(logData);
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
      return result;
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
        COALESCE(date, date_total) AS date,
        COALESCE(approved, 0) AS approved,
        COALESCE(fetched, 0) AS fetched,
        COALESCE(appended, 0) AS appended,
        COALESCE(total_fetched, 0) AS total_fetched,
        COALESCE(classified_offers, 0) AS offers,
        COALESCE(classified_sba, 0) AS sba,
        COALESCE(classified_partnership, 0) AS partnership
      FROM (
        -- Main combined data (approved, fetched_interested, appended)
        SELECT 
          date,
          SUM(approved) AS approved,
          SUM(fetched) AS fetched,
          SUM(appended) AS appended
        FROM (
          SELECT approval_date AS date, approved_count AS approved, 0 AS fetched, 0 AS appended
          FROM approved_encoding_lead
          UNION ALL
          SELECT date_fetched AS date, 0, fetched_count, 0
          FROM fetched_interested_lead
          UNION ALL
          SELECT appended_date AS date, 0, 0, appended_count
          FROM appended_to_crm
        ) AS base
        GROUP BY date
      ) AS combined
      FULL OUTER JOIN (
        -- Separate fetched_leads total
        SELECT 
          date_fetched AS date_total,
          fetched_count AS total_fetched
        FROM fetched_leads
      ) AS totals
      ON combined.date = totals.date_total
      LEFT JOIN (
        -- Pivot classified_interest_replies into columns
        SELECT 
          date_fetched,
          SUM(CASE WHEN type = 'offers' THEN fetched_count ELSE 0 END) AS classified_offers,
          SUM(CASE WHEN type = 'sba' THEN fetched_count ELSE 0 END) AS classified_sba,
          SUM(CASE WHEN type = 'partnership' THEN fetched_count ELSE 0 END) AS classified_partnership
        FROM classified_interest_replies
        GROUP BY date_fetched
      ) AS classified
      ON COALESCE(combined.date, totals.date_total) = classified.date_fetched
      ORDER BY COALESCE(date, date_total);
    `;

    const result = await con.query(query);

    // Separate logs and encodingClassification
    const logs = [];
    const encodingClassification = [];

    result.rows.forEach(row => {
      logs.push({
        date: row.date,
        approved: row.approved,
        fetched: row.fetched,
        appended: row.appended,
        total_fetched: row.total_fetched
      });

      encodingClassification.push({
        date: row.date,
        offers: row.offers,
        sba: row.sba,
        partnership: row.partnership
      });
    });

    responseReturn(res, 200, { logs, encodingClassification });
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
