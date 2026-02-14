import fs from "node:fs/promises";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

const SHEET_SCOPE = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const SHEET_ID_RE = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;

function fileExists(filePath) {
  return fs
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}

function parseSpreadsheetId(url) {
  const match = url.match(SHEET_ID_RE);
  if (!match) {
    throw new Error(`Invalid Google Sheets URL: ${url}`);
  }
  return match[1];
}

async function oauthClientFromToken(credentialsPath, tokenPath) {
  if (!(await fileExists(credentialsPath)) || !(await fileExists(tokenPath))) return null;
  const credsRaw = JSON.parse(await fs.readFile(credentialsPath, "utf8"));
  const tokenRaw = JSON.parse(await fs.readFile(tokenPath, "utf8"));
  const payload = credsRaw.installed ?? credsRaw.web;
  if (!payload?.client_id || !payload?.client_secret) return null;

  const client = new google.auth.OAuth2(
    payload.client_id,
    payload.client_secret,
    payload.redirect_uris?.[0]
  );
  client.setCredentials(tokenRaw);
  return client;
}

async function interactiveOAuth(credentialsPath, tokenPath) {
  if (!(await fileExists(credentialsPath))) return null;
  const authClient = await authenticate({
    scopes: SHEET_SCOPE,
    keyfilePath: credentialsPath
  });
  await fs.writeFile(tokenPath, JSON.stringify(authClient.credentials, null, 2), "utf8");
  return authClient;
}

async function buildAuthClient() {
  const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (serviceAccountPath) {
    return new google.auth.GoogleAuth({
      keyFile: serviceAccountPath,
      scopes: SHEET_SCOPE
    });
  }

  const credentialsPath = process.env.GOOGLE_OAUTH_CLIENT_SECRETS ?? "credentials.json";
  const tokenPath = process.env.GOOGLE_TOKEN_FILE ?? "token.json";

  const tokenClient = await oauthClientFromToken(credentialsPath, tokenPath);
  if (tokenClient) return tokenClient;

  const interactiveClient = await interactiveOAuth(credentialsPath, tokenPath);
  if (interactiveClient) return interactiveClient;

  return new google.auth.GoogleAuth({ scopes: SHEET_SCOPE });
}

export async function createSheetsApi(options = {}) {
  const auth = options.apiKey || (await buildAuthClient());
  return google.sheets({ version: "v4", auth });
}

function escapeSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

function unescapeRangeTitle(rangeValue) {
  const raw = String(rangeValue ?? "").trim();
  if (!raw) return "";
  const beforeBang = raw.split("!")[0];
  const noQuotes = beforeBang.replace(/^'/, "").replace(/'$/, "");
  return noQuotes.replace(/''/g, "'");
}

export async function fetchSpreadsheetDocument(sheetsApi, documentConfig) {
  const spreadsheetId = parseSpreadsheetId(documentConfig.url);
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    includeGridData: false
  });

  const documentTitle = meta.data.properties?.title ?? documentConfig.name;
  const sheetTitles = (meta.data.sheets ?? [])
    .map((item) => item.properties?.title)
    .filter((item) => typeof item === "string");

  if (sheetTitles.length === 0) {
    return {
      spreadsheetId,
      documentName: documentConfig.name,
      documentTitle,
      worksheets: []
    };
  }

  const valuesResponse = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId,
    majorDimension: "ROWS",
    ranges: sheetTitles.map(escapeSheetTitle)
  });

  const valueRanges = valuesResponse.data.valueRanges ?? [];
  const byTitle = new Map(
    valueRanges.map((item) => [unescapeRangeTitle(item.range), item.values ?? []])
  );
  const worksheets = sheetTitles.map((title, index) => ({
    title,
    values: (byTitle.get(title) ?? valueRanges[index]?.values ?? []).map((row) =>
      row.map((cell) => String(cell))
    )
  }));

  return {
    spreadsheetId,
    documentName: documentConfig.name,
    documentTitle,
    worksheets
  };
}
