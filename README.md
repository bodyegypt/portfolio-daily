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

Optional flags:

```bash
npm run daily -- [options]

Options:
  --config <path>       Config file (default: inputs.json)
  --output-dir <path>   Report output directory (default: reports)
  --date <YYYY-MM-DD>   Report date (default: today)
  --no-html             Skip HTML report generation
  --diff <YYYY-MM-DD>   Compare against a specific date
  --lookback <days>     Historical trend lookback (default: 7)
```

## 5. Facts pass output shape

Pass-1 outputs per run:

| File | Description |
|---|---|
| `reports/YYYY-MM-DD.md` | Factual markdown report with health score, diff, and sparkline trends |
| `reports/YYYY-MM-DD.json` | Machine-readable JSON with all enrichments |
| `reports/YYYY-MM-DD.html` | Self-contained HTML dashboard with treemap and heatmap |

Each worksheet entry includes wallet metadata:

- `walletId` (stable id)
- `walletName` (e.g. `Thndr US / Crypto`)
- `walletType` (e.g. `us_equities`, `us_crypto`, `egx_equities`)

No action recommendations are emitted in pass-1 outputs.

## 6. Enrichments

The facts pass automatically generates these additional analytics when historical data is available:

### Portfolio Health Score

A composite 0-100 score across four dimensions (25 points each):

- **Diversification** - Position count, weight distribution (HHI), underweight penalty
- **Risk Exposure** - Overweight positions, concentration breaches, big losers
- **Performance** - Overall P&L percentage, drawdown severity
- **Data Quality** - Weird/missing values, parse failures

Displayed as a visual bar in the terminal and a gauge in the HTML report.

### Day-over-Day Diff

Automatically compares today's report with the most recent previous report:

- Portfolio-level delta (market value, P&L, position count)
- New positions entered
- Positions closed/exited
- Biggest P&L gainers and losers
- Weight shift analysis

Use `--diff 2026-02-10` to compare against a specific date.

### Historical Trends & Sparklines

Reads past JSON reports (default: 7-day lookback) and computes:

- Per-position P&L sparklines (`▁▂▃▅▇`) in terminal output
- Trend classification (uptrend/downtrend/sideways) per position
- Momentum score (rate of change)
- 3-day and 5-day moving averages
- Portfolio-level trend with sparkline visualization

Use `--lookback 14` to extend the lookback window.

### HTML Dashboard

A single self-contained `.html` file with:

- Dark-themed responsive layout (no external dependencies)
- Top-level metric cards (market value, invested, P&L, return)
- Health score gauge with dimension breakdown
- Interactive position treemap colored by P&L performance
- Full position table with P&L bars
- Per-wallet summary cards
- Day-over-day diff section (when available)

## 7. Run AI pass (wallet-first)

Use `$portfolio-daily-analyst` after daily run.
The AI pass must provide separate sections for each wallet (for your current setup: US equities wallet, US crypto wallet, EGX wallet), plus cross-wallet synthesis and alternatives.
