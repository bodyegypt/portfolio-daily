Historical design notes for the first implementation of this repo.
Current source of truth is `README.md` + `.codex/skills/portfolio-daily-analyst/SKILL.md`.

Build a reusable local CLI project (a codex skill) that I can run daily.

High-level behavior

- I will run the tool manually once per day from inside this repo.
- I will NOT pass sheet links on the command line.
- I will store Google Sheets DOCUMENT links one time in an input file.
- On every run, the tool reads that input file, connects to Google Sheets, and for EACH document:
  - fetches ALL worksheets/tabs inside the document
  - extracts holdings tables from each worksheet (skip totals-only sections when possible)
  - analyzes and produces a daily report with decision-support “options” (not absolute commands)

Inputs

1. inputs.json has sheets links reflect users live holdings

Analysis requirements (per worksheet and combined)

1. Portfolio snapshot

- total spent, total market value, total P&L, total %P&L
- top positions by market weight

2. Risk & concentration

- positions above maxPositionWeight
- top3 concentration above threshold
- big losers below drawdownWarnPct
- any weird/missing values

3. Actions (as options, not orders)

- Trim candidates: overweight positions; explain tradeoffs
- Add candidates: underweight positions (if user has a watchlist in inputs.json OR simply show underweights without telling to buy)
- Stop-loss review: big losers; present options: hold/reduce/exit; warn about averaging down
- Take-profit review: big winners; options: hold/trim/rebalance

4. “What else to consider” checklist

- thesis check, news/events, liquidity, currency risk, position sizing, rebalancing discipline

Output

- Write a Markdown report to: ./reports/YYYY-MM-DD.md
- Write a JSON summary to: ./reports/YYYY-MM-DD.json
- Also print a short console summary.
