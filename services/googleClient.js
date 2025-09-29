// services/googleClient.js
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import fs from "fs/promises";

let sheets, drive, auth;

export async function initGoogleClients() {
  if (sheets && drive) return { sheets, drive, auth };

  const credentials = JSON.parse(await fs.readFile("credentials.json", "utf-8"));

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

  return { sheets, drive, auth };
}
