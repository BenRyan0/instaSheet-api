require("dotenv").config({ silent: true });
const axios = require("axios");
const redisClient = require("../../../config/redisClient.js");
const { colorize } = require("../../../utils/colorLogger");
const con = require("../../../db/db.js");

async function fetchLeadsPageWebhook({
  pageLimit = 2,
  authHeaders,
  setErrorOccurred,
  setErrorContext,
}) {
  try {
    // 1️ Get unprocessed emails
    const { rows: emails } = await con.query(
      `
      SELECT id, campaign_id, email
      FROM tobe_processed_campaign_emails
      WHERE is_processed = FALSE
      ORDER BY created_at DESC
      LIMIT $1;
    `,
      [pageLimit]
    );

    if (emails.length === 0) {
      console.log("No unprocessed emails found.");
      return {
        items: [],
        next_starting_after: null,
        message: "No unprocessed emails found.",
      };
    }

    const contactList = emails.map((e) => e.email);
    console.log(`Sending POST to Instantly API with contacts:`, contactList);

    // 2️ POST request via axios
    const response = await axios.post(
      "https://api.instantly.ai/api/v2/leads/list",
      {
        contacts: contactList,
        limit: pageLimit,
      },
      {
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
      }
    );

    // 3️ Mark emails as processed
    const processedIds = emails.map((e) => e.id);
    await con.query(
      `
      UPDATE tobe_processed_campaign_emails
      SET is_processed = TRUE, updated_at = NOW()
      WHERE id = ANY($1::int[]);
    `,
      [processedIds]
    );

    console.log(`Marked ${processedIds.length} emails as processed.`);

    // 4️ Return Instantly API data (so your caller gets it)
    return response.data;
  } catch (error) {
    console.error("Error fetching leads batch:", error.message);
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext)
      setErrorContext(`fetchLeadsPageWebhook: ${error.message}`);
    console.log("Error in fetchAllInterestedLeadsPage:", error.message);
    throw error;
  } finally {
    console.log("fetchLeadsPage finished (connection remains open).");
  }
}

async function fetchLeadsPage({
  cursor = null,
  pageLimit,
  authHeaders,
  setErrorContext,
  setErrorOccurred,
}) {
  console.log("FetchAllInterestedLeadsPage -init");

  const redisCursorKey = `insta:global_cursor:${pageLimit}`;
  const redisFailCountKey = `insta:global_cursor_failcount:${pageLimit}`;

  try {
    // Step 1: Get stored cursor (if any)
    let storedCursor = await redisClient.get(redisCursorKey);
    const effectiveCursor = storedCursor || cursor || "";

    console.log(`Using global cursor (limit=${pageLimit}):`, effectiveCursor);

    // Step 2: Build request
    const body = {
      filter: "FILTER_LEAD_INTERESTED",
      limit: pageLimit,
      starting_after: effectiveCursor,
    };

    // Step 3: Send API request
    const response = await axios.post(
      `https://api.instantly.ai/api/v2/leads/list`,
      body,
      {
        headers: authHeaders,
      }
    );

    const leads = response.data?.items || [];
    console.log(response.data);

    console.log(colorize("Fetched Leads ...", "cyan"));
    leads.forEach((lead, index) => {
      console.log(colorize(`${index + 1}. ${lead.email}`, "cyan"));
    });

    // Step 4: Handle cursor logic
    if (response.data?.next_starting_after) {
      const newCursor = response.data.next_starting_after;

      await redisClient.set(redisCursorKey, newCursor, { EX: 1800 });
      await redisClient.del(redisFailCountKey);

      console.log(`Updated global Redis cursor: ${newCursor}`);
    } else {
      console.log("No new cursor returned by API — keeping current cursor.");

      const failCount =
        (parseInt(await redisClient.get(redisFailCountKey)) || 0) + 1;
      await redisClient.set(redisFailCountKey, failCount, { EX: 7200 });

      console.log(`No-cursor streak: ${failCount} time(s)`);

      if (failCount >= 3) {
        console.warn("No new cursor after 3 attempts — resetting cursor.");
        await redisClient.del(redisCursorKey);
        await redisClient.del(redisFailCountKey);
      }
    }

    console.log("FetchAllInterestedLeadsPage END");
    return response.data;
  } catch (error) {
    if (setErrorOccurred) setErrorOccurred(true);
    if (setErrorContext) setErrorContext(`fetchLeadsPage: ${error.message}`);
    console.log("Error in fetchAllInterestedLeadsPage:", error.message);
    throw error;
  }
}

function getNextCursor(apiResponse) {
  if (!Array.isArray(apiResponse) || apiResponse.length === 0) {
    return null;
  }
  const lastLead = apiResponse[apiResponse.length - 1];
  return lastLead && lastLead.id ? lastLead.id : null;
}

module.exports = {
  fetchLeadsPage,
  getNextCursor,
  fetchLeadsPageWebhook,
};
