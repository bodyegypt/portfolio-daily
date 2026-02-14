# portfolio-daily (Node.js)

Two-pass workflow:

1. Facts pass (`npm run daily`)
- Reads `inputs.json`.
- Fetches all worksheets from each Google Sheet document.
- Writes factual outputs only:
  - `reports/YYYY-MM-DD.md`
  - `reports/YYYY-MM-DD.json`

2. AI pass (Codex with `$portfolio-daily-analyst`)
- Reads factual outputs.
- Produces strategy outputs:
  - `reports/YYYY-MM-DD.ai.md`
  - `reports/YYYY-MM-DD.ai.json`

## 1. Install

```bash
npm install
```

## 2. Configure local inputs and secrets

1. Start from template:

```bash
cp inputs.example.json inputs.json
```

2. Fill `inputs.json` with your sheet document links.
3. Keep real keys local only (`inputs.json` is ignored).
4. Preferred key source: `GOOGLE_API_KEY` env var.  
   `inputs.json.googleApiKey` is allowed as a local fallback.

### Private sheets options

1. Service account: set `GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/service-account.json`.
2. OAuth desktop flow: `credentials.json` + cached `token.json`.
3. ADC: `gcloud auth application-default login`.

## 3. Inputs contract

`inputs.json` requires:

- `documents[]` with Google Sheets URLs.
- `currency` per document (3-letter code, e.g. `USD`, `EGP`).

Risk values accept decimal (`0.2`) or percent style (`20`, `"20%"`).

## 4. Run facts pass

```bash
npm run daily
```

Optional:

```bash
npm run daily -- --config inputs.json --output-dir reports --date 2026-02-14
```

## 5. Facts pass output shape

Pass-1 JSON is factual only.  
Each worksheet entry includes wallet metadata:

- `walletId` (stable id)
- `walletName` (e.g. `Thndr US / Crypto`)
- `walletType` (e.g. `us_equities`, `us_crypto`, `egx_equities`)

No action recommendations are emitted in pass-1 outputs.

## 6. Run AI pass (wallet-first)

Use `$portfolio-daily-analyst` after daily run.  
The AI pass must provide separate sections for each wallet (for your current setup: US equities wallet, US crypto wallet, EGX wallet), plus cross-wallet synthesis and alternatives.
