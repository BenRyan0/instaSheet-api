// config/index.js

/**
 * Base URL for all Instantly.ai API calls.
 * Falls back to the public endpoint if no env var is set.
 */
const API_BASE =
  process.env.INSTANTLY_API_BASE?.trim() ||
  'https://api.instantly.ai/v1'

/**
 * Path for listing leads.  
 * Full URL = `${API_BASE}${LEADS_LIST_PATH}`
 */
const LEADS_LIST_PATH =
  process.env.LEADS_LIST_PATH?.trim() ||
  '/leads/list'

/**
 * Path for fetching emails.  
 * Full URL = `${API_BASE}${EMAILS_PATH}`
 */
const EMAILS_PATH =
  process.env.EMAILS_PATH?.trim() ||
  '/emails'

module.exports = {
  API_BASE,
  LEADS_LIST_PATH,
  EMAILS_PATH,
}
