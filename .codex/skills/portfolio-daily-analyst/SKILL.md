---
name: portfolio-daily-analyst
description: "Run and maintain a two-stage portfolio workflow in this repo: (1) produce strict factual reports from Google Sheets, and (2) produce a wallet-first AI decision report with explicit buy/sell/hold actions, sizing, probabilities, and expected outcomes for US equities wallet, US crypto wallet, and EGX wallet."
---

# Portfolio Daily Analyst

Use the local project at repository root.

## Run Facts Pass

1. Run `npm run daily -- --score-ai`.
2. Confirm output files exist:
`reports/YYYY-MM-DD.md`
`reports/YYYY-MM-DD.json`
`reports/ai-learning.json` (cumulative learning ledger)
`reports/ai-learning-context.md` (learning context for AI pass)
3. Keep this pass factual only. Allowed sections:
- portfolio snapshots
- concentration/risk metrics as computed facts
- market splits by currency and market
- accounting adjustments (for example `OLD LOSS`)
- wallet metadata (`walletId`, `walletName`, `walletType`)

Do not add strategy/advice/action recommendations to the first report.

## Run Post-Analysis Pass

1. Use the template prompt below in a new Codex run.
2. Replace `YYYY-MM-DD` with today's date.
3. Follow it exactly:
- Read `reports/YYYY-MM-DD.json` and `reports/YYYY-MM-DD.md`
- Research latest macro and geopolitics with dated sources
- Produce:
`reports/YYYY-MM-DD.ai.md`
`reports/YYYY-MM-DD.ai.json`

Use this template:

```md
You are my cross-market portfolio strategist and decision partner.
Use my factual daily report as ground truth, then give a practical action plan with your own conviction view.

IMPORTANT — Self-Learning Protocol:
Before writing your analysis, read the learning context file. It contains your historical
prediction accuracy, calibration data, and self-improvement directives based on how your
past predictions actually performed. Use this to adjust your confidence levels, action
thresholds, and analytical focus. If a past pattern shows you are overconfident or biased
in a certain direction, explicitly correct for it.

Read:
- reports/YYYY-MM-DD.json
- reports/YYYY-MM-DD.md
- reports/ai-learning-context.md (if it exists — your past accuracy and self-learning data)
- reports/ai-learning.json (if it exists — detailed prediction ledger)

Write:
- reports/YYYY-MM-DD.ai.md
- reports/YYYY-MM-DD.ai.json

Primary layout (wallet-first, mandatory):
1) Wallet: Thndr US / Sheet1 (US equities wallet)
2) Wallet: Thndr US / Crypto (US crypto wallet)
3) Wallet: Thndr Egx / Sheet1 (EGX wallet)

For each wallet section include:
- Current wallet factual anchor (weights, concentration, winners/losers)
- Market context relevant to that wallet
- Most-likely scenario for:
  - next 24h
  - next 2 weeks
  with probability (%) and clear why
- Direct action plan table for each current holding with:
  - symbol
  - action now: BUY / HOLD / SELL / TRIM
  - size change (% of wallet and approximate notional in wallet currency)
  - trigger level or execution condition
  - invalidation/stop level
  - expectation if correct and if wrong
- Prioritized top 3 action items (ranked by expected value)
- Alternatives mapped to that wallet (hedges, defensive sleeves, cash/fixed-income where relevant)

Then add cross-wallet synthesis:
4) Cross-wallet market synthesis (US equities / crypto / EGX interactions)
5) Consolidated capital-allocation plan across wallets:
- target allocation %
- delta from current
- why this mix is most likely to work
6) Scenario matrix (bull/base/bear) with probabilities, triggers, invalidation, and what to do in each case

Output constraints:
- Be decisive and practical; avoid generic language.
- Use explicit buy/sell/hold wording and sizing.
- Always state highest-likelihood path and why.
- Use explicit dates and confidence levels.
- Distinguish the two US wallets explicitly; do not merge US equities and US crypto into one wallet section.
- Include top 5 risks and top 5 opportunities for:
  - next 24h
  - next 2 weeks
- Keep actions consistent with portfolio risk limits unless explicitly overriding with rationale.
- Include dated sources for macro/policy statements.

AI JSON structure requirements (for self-learning tracking):
The `.ai.json` file MUST include a top-level `wallets` array with structured actions.
Each wallet object must have:
- `walletName`: string (e.g. "Thndr US / Sheet1")
- `actions`: array of objects, each with:
  - `symbol`: ticker string
  - `action`: one of BUY / HOLD / SELL / TRIM
  - `confidence`: number 0-1 (probability this is correct)
  - `horizon`: "24h" or "2w"
  - `sizeChange`: string (e.g. "+5%" or "-3%")
  - `triggerLevel`: number or null
  - `stopLevel`: number or null
- `scenarios`: array of objects, each with:
  - `label`: "bull" / "base" / "bear"
  - `probability`: number 0-1
  - `horizon`: "24h" or "2w"

Also include a top-level `scenarioMatrix` array with the same scenario structure for cross-wallet scenarios.

If learning context was available, include a `learningAdjustments` section in the JSON
describing what you changed in this analysis based on past accuracy data.
```

## Fixing Data Issues

When numbers look wrong:

1. Inspect raw worksheet rows using the existing Google Sheets fetch path in `src/googleSheets.js`.
2. Inspect parser outputs from `src/parser.js` for:
- header mapping issues
- percent vs absolute value mixups
- totals/summary row leakage
- repeated ticker consolidation behavior
3. Keep repeated symbols valid (multi-lot/multi-platform tracking).
4. Keep per-document currency handling intact (`documents[].currency` in `inputs.json`).
5. Preserve adjustment rows like `OLD LOSS` in totals as accounting adjustments, not holdings.
6. Keep wallet metadata accurate for each worksheet:
- `walletId`
- `walletName`
- `walletType`

## Output Contract

Always preserve:

- `reports/YYYY-MM-DD.md` as strict factual pass
- `reports/YYYY-MM-DD.json` as machine-readable factual pass (with wallet metadata)
- `reports/YYYY-MM-DD.ai.md` and `.ai.json` generated only in second pass with wallet-first, action-oriented analysis
- `reports/ai-learning.json` — cumulative AI prediction ledger (auto-updated by `--score-ai`)
- `reports/ai-learning-context.md` — learning context consumed by AI pass (auto-generated)
- `reports/YYYY-MM-DD.ai-scorecard.md` and `.json` — daily AI accuracy scorecard (auto-generated)
