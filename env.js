require("dotenv").config(); // Automatically load .env at startup
const { z } = require("zod");

// Define schema
const envSchema = z.object({
  PORT: z.coerce.number(),
  MODE: z.string(),
  SECRET: z.string(),
  JWT_SECRET: z.string(),

  PG_HOST: z.string(),
  PG_USER: z.string(),
  PG_PASSWORD: z.string(),
  PG_DB: z.string(),
  PG_PORT: z.coerce.number(),

  REDIS_URL: z.string(),

  INSTANTLY_API_BASE: z.string(),
  LEADS_LIST_PATH: z.string(),
  EMAILS_PATH: z.string(),
  CAMPAIGNS_PATH: z.string(),
  INSTANTLY_API_KEY: z.string(),
  SPREADSHEET_ID: z.string(),

  OPEN_ROUTER_MODEL: z.string(),
  OPEN_ROUTER_MODEL2: z.string(),
  OPEN_ROUTER_LOCATION_MODEL: z.string(),
  LOCAL_LLM: z.string(),
  USE_LOCAL: z.coerce.boolean(),

  AGENT_NAME: z.string(),
  CLIENT: z.string(),
  CLIENT1: z.string(),

  N8N_FALLBACK_WEBHOOK: z.string(),
  FIRECRAWL_API: z.string(),
  SERPAPI_KEY: z.string(),
  SCRAPINGROBOT_API_KEY: z.string(),

  OPENROUTER_API_KEY: z.string(),
  OPENROUTER_API_KEY2: z.string(),
  OPENROUTER_API_KEY3: z.string(),
  OPENROUTER_API_SEC_KEY: z.string(),

  PERFEX_CRM_API_KEY: z.string(),
});

let env;

try {
  env = envSchema.parse(process.env);
} catch (err) {
  console.error("Invalid or missing environment variables:");
  for (const issue of err.errors) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

module.exports = env;
