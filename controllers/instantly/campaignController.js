require("dotenv").config({ silent: true });
const { responseReturn } = require("../../utils/response");
const { API_BASE, CAMPAIGNS_PATH,CAMPAIGNS_PAGE_SIZE } = require("../../config");


class campaignController {
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
        const params = new URLSearchParams({ limit: String(CAMPAIGNS_PAGE_SIZE) });
        if (cursor) params.set("starting_after", cursor);

        const resp = await fetch(`${API_BASE}${CAMPAIGNS_PATH}?${params}`, { headers });

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
}

module.exports = new campaignController();
