// services/googleClient.js

import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { promises as fs } from "fs";

let sheets = null;
let drive = null;
let auth = null;

/**
 * Initialize and cache Google Sheets and Drive clients.
 * Only runs once per runtime to save API and auth overhead.
 */
export async function initGoogleClients() {
  if (sheets && drive && auth) return { sheets, drive, auth };

  try {
    const credentialsPath = new URL("../credentials.json", import.meta.url);
    const credentialsData = await fs.readFile(credentialsPath, "utf-8");
    const credentials = JSON.parse(credentialsData);

    auth = new GoogleAuth({
      credentials,
      scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets",
      ],
    });

    const client = await auth.getClient();

    sheets = google.sheets({ version: "v4", auth: client });
    drive = google.drive({ version: "v3", auth: client });

    console.log("Google API clients initialized successfully.");

    return { sheets, drive, auth };
  } catch (error) {
    console.error("Failed to initialize Google clients:", error.message);
    throw error;
  }
}
