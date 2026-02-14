---
name: portfolio-daily-analyst
description: "Run and maintain a two-stage portfolio workflow in this repo: (1) generate factual daily market reports from Google Sheets with no advice, risk, or deep-insight sections, then (2) generate a second smart report by reading today's reports/YYYY-MM-DD.md and reports/YYYY-MM-DD.json with macro/geopolitical research. Use when user asks for daily portfolio report runs, data-fixes, report-quality improvements, or post-report strategy analysis across US equities, crypto, and EGX."
---

# Portfolio Daily Analyst

Use the local project at repository root.

## Run Facts Pass

1. Run `npm run daily`.
2. Confirm output files exist:
`reports/YYYY-MM-DD.md`
`reports/YYYY-MM-DD.json`
3. Keep this pass factual only:
- Portfolio snapshot
- Market splits by currency and market
- Accounting adjustments (for example `OLD LOSS`)

Do not add strategy/advice to the first report.

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
You are my cross-market portfolio strategist.
Use my factual daily report as ground truth, then add latest dated market + geopolitical context with sources.

Read:
- reports/YYYY-MM-DD.json
- reports/YYYY-MM-DD.md

Write:
- reports/YYYY-MM-DD.ai.md
- reports/YYYY-MM-DD.ai.json

Required scope:
1) US stocks market:
- Macro regime (rates, inflation, labor, USD, yields)
- Sector rotation and concentration risk
- Portfolio-specific options (not orders)

2) Crypto market:
- Liquidity/risk-on regime
- BTC/ETH structure, flows, regulation/policy risk
- Portfolio-specific options (not orders)

3) EGX market:
- EGP/FX sensitivity, local rates/inflation, policy + liquidity
- Portfolio-specific options (not orders)

4) Alternatives:
- Gold/silver/commodities, short-duration fixed income, cash buffer, defensive sleeves
- Explain where alternatives hedge current portfolio exposures

5) Technical-analysis move plan:
- Multi-timeframe structure (trend, momentum, volatility, support/resistance, invalidation levels)
- Triggered move map:
  - if breakout, then option set A
  - if breakdown, then option set B
  - if range, then option set C

6) Scenario matrix:
- Bull/base/bear with probabilities, triggers, and invalidation

Output constraints:
- Keep recommendations as options with tradeoffs, not hard buy/sell commands.
- Use explicit dates and confidence levels.
- Highlight top 5 risks and top 5 opportunities for next 24h and next 2 weeks.
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

## Output Contract

Always preserve:

- `reports/YYYY-MM-DD.md` as factual
- `reports/YYYY-MM-DD.json` machine-readable
- `reports/YYYY-MM-DD.ai.md` and `.ai.json` generated only in second pass
