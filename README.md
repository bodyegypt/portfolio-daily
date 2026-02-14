# portfolio-daily (Node.js)

Daily CLI that reads Google Sheets document links from `inputs.json`, parses holdings from every worksheet/tab, and writes:

- `reports/YYYY-MM-DD.md`
- `reports/YYYY-MM-DD.json`

The daily report is factual only (snapshot-style, no advice/risk/deep-insight sections).

## 1. Install

```bash
npm install
```

## 2. Configure Google Sheets access (simplest first)

### Option A (simplest): API key for public/link-viewable sheets

Create a Google API key with **Google Sheets API** enabled, then put it in `inputs.json`:

```json
{
  "googleApiKey": "YOUR_API_KEY",
  "documents": [
    { "name": "Portfolio US", "url": "https://docs.google.com/spreadsheets/d/..." }
  ]
}
```

Then run `npm run daily`.

### Option B: OAuth / service account (private sheets)

1. Service account
Set `GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json` and share sheets with that service account email.

2. OAuth client (interactive once, then token cache)
Place OAuth desktop client secrets at `credentials.json` (or set `GOOGLE_OAUTH_CLIENT_SECRETS`).
First run opens browser auth and saves `token.json` (or `GOOGLE_TOKEN_FILE`).

3. Application Default Credentials (ADC)
If `gcloud auth application-default login` is configured, the CLI can use it.

## 3. Inputs

`inputs.json` must include document links:

```json
{
  "googleApiKey": "YOUR_API_KEY",
  "documents": [
    { "name": "Portfolio US", "url": "https://docs.google.com/spreadsheets/d/...", "currency": "USD" },
    { "name": "Portfolio EGX", "url": "https://docs.google.com/spreadsheets/d/...", "currency": "EGP" }
  ],
  "baseCurrency": "USD",
  "watchlist": ["AAPL", "MSFT"],
  "risk": {
    "maxPositionWeight": 0.2,
    "top3ConcentrationWarn": 0.55,
    "drawdownWarnPct": -0.15,
    "takeProfitWarnPct": 0.25,
    "minPositionWeight": 0.02
  }
}
```

Risk values can be decimals (`0.2`) or percents (`20` or `"20%"`).
If document currencies differ, the report outputs combined totals per currency (no invalid mixed sum).

## 4. Run daily

```bash
npm run daily
```

Optional:

```bash
npm run daily -- --config inputs.json --output-dir reports --date 2026-02-14
```

## 5. Run Codex for smart report

After daily run, invoke the skill prompt from `$portfolio-daily-analyst`.
It instructs Codex to read today's factual files and generate:

- `reports/YYYY-MM-DD.ai.md`
- `reports/YYYY-MM-DD.ai.json`
