// Instantly.ai base api endpoint
require('dotenv').config()

const API_BASE =
  process.env.INSTANTLY_API_BASE?.trim() || "https://api.instantly.ai";

// Instantly.ai leads list api endpoint
const LEADS_LIST_PATH =
  process.env.LEADS_LIST_PATH?.trim() || "/api/v2/leads/list";

// Instantly.ai emails api end point
const EMAILS_PATH = process.env.EMAILS_PATH?.trim() || "/api/v2/emails";

module.exports = {
  API_BASE,
  LEADS_LIST_PATH,
  EMAILS_PATH,
};
