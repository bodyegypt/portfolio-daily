import fs from "node:fs/promises";
import path from "node:path";

function fmtCurrency(value, currency) {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function fmtPct(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(2)}%`;
}

function fmtMaybeCurrency(value, currency) {
  if (!Number.isFinite(value)) return "n/a";
  return fmtCurrency(value, currency);
}

function sectionRisk(report) {
  const lines = [];
  lines.push("### Risk & Concentration");

  lines.push(`- Positions above max weight: ${report.risk.overweightPositions.length}`);
  report.risk.overweightPositions.forEach((item) => {
    lines.push(`- Overweight: ${item.symbol} at ${fmtPct(item.marketWeight)}`);
  });

  lines.push(
    `- Top 3 concentration: ${fmtPct(report.risk.top3Concentration)} (breach: ${
      report.risk.top3ConcentrationBreached ? "yes" : "no"
    })`
  );
  lines.push(`- Big losers below drawdown threshold: ${report.risk.bigLosers.length}`);
  report.risk.bigLosers.forEach((item) => {
    lines.push(`- Loser: ${item.symbol} at ${fmtPct(item.pnlPct)}`);
  });

  lines.push(`- Weird/missing values: ${report.risk.weirdValues.length}`);
  report.risk.weirdValues.slice(0, 10).forEach((item) => lines.push(`- ${item}`));
  if (report.risk.weirdValues.length > 10) lines.push("- ...truncated in markdown; full list in JSON.");

  return lines;
}

function sectionSnapshot(report, currency) {
  const lines = [];
  const adj = report.snapshot.adjustments ?? { count: 0 };
  lines.push("### Portfolio Snapshot");
  lines.push(`- Total spent: ${fmtCurrency(report.snapshot.totalSpent, currency)}`);
  lines.push(`- Total market value: ${fmtCurrency(report.snapshot.totalMarketValue, currency)}`);
  lines.push(`- Total P&L: ${fmtCurrency(report.snapshot.totalPnl, currency)}`);
  lines.push(`- Total %P&L: ${fmtPct(report.snapshot.totalPnlPct)}`);
  if ((adj.count ?? 0) > 0) {
    const kinds = (adj.byKind ?? [])
      .map((item) => `${item.kind} ${fmtCurrency(item.amount, currency)}`)
      .join(", ");
    lines.push(
      `- Accounting adjustments: ${adj.count} rows | spent delta ${fmtCurrency(adj.spentDelta, currency)} | P&L delta ${fmtCurrency(adj.pnlDelta, currency)}${kinds ? ` | ${kinds}` : ""}`
    );
  }
  lines.push(`- Positions parsed: ${report.positionCount}`);
  lines.push("- Top positions by market weight:");
  report.snapshot.topPositions.forEach((item) => {
    lines.push(
      `- ${item.symbol}: ${fmtPct(item.marketWeight)} (${fmtCurrency(item.marketValue, currency)})`
    );
  });
  if (!report.snapshot.topPositions.length) lines.push("- None.");
  return lines;
}

function sectionDeepInsights(report, currency) {
  const d = report.deepInsights ?? {};
  const lines = [];
  lines.push("### Deep Insights");
  lines.push(`- Concentration stress: ${d.concentrationStress ?? "n/a"}`);
  lines.push(
    `- Hit rate: ${fmtPct(d.hitRate)} (${d.winnerCount ?? 0} winners / ${d.loserCount ?? 0} losers / ${d.flatCount ?? 0} flat)`
  );
  lines.push(`- Average winner %: ${fmtPct(d.avgWinnerPct)} | Average loser %: ${fmtPct(d.avgLoserPct)}`);
  lines.push(
    `- Inactive rows: ${d.inactivePositionCount ?? 0} | Dormant capital: ${fmtMaybeCurrency(
      d.deadCapitalSpent,
      currency
    )}`
  );

  lines.push("- Top contributors:");
  (d.topContributors ?? []).forEach((item) =>
    lines.push(`- ${item.symbol}: ${fmtCurrency(item.pnl, currency)} (${fmtPct(item.pnlPct)})`)
  );
  if (!(d.topContributors ?? []).length) lines.push("- None.");

  lines.push("- Top detractors:");
  (d.topDetractors ?? []).forEach((item) =>
    lines.push(`- ${item.symbol}: ${fmtCurrency(item.pnl, currency)} (${fmtPct(item.pnlPct)})`)
  );
  if (!(d.topDetractors ?? []).length) lines.push("- None.");

  lines.push("- Multi-lot/platform symbols (consolidated by ticker for risk):");
  (d.multiLotSymbols ?? []).forEach((item) =>
    lines.push(
      `- ${item.symbol}: ${item.rows} rows, ${fmtCurrency(item.marketValue, currency)} market value, ${fmtCurrency(item.pnl, currency)} P&L`
    )
  );
  if (!(d.multiLotSymbols ?? []).length) lines.push("- None.");

  return lines;
}

export function toMarkdown(dailyReport) {
  const lines = [];
  lines.push(`# Daily Portfolio Report - ${dailyReport.date}`);
  lines.push("");
  lines.push(`Base currency: **${dailyReport.baseCurrency}**`);
  lines.push("");
  if (dailyReport.mixedCurrency) {
    lines.push("## Combined Portfolio");
    lines.push("- Mixed currencies detected. Totals are shown per currency to avoid invalid aggregation.");
    lines.push("");
    lines.push("## Combined By Currency");
    dailyReport.combinedByCurrency.forEach((item) => {
      lines.push("");
      lines.push(`### ${item.currency}`);
      lines.push(...sectionSnapshot(item.analysis, item.currency));
    });
    lines.push("");
  } else {
    lines.push("## Combined Portfolio");
    lines.push(...sectionSnapshot(dailyReport.combined, dailyReport.combinedCurrency || dailyReport.baseCurrency));
    lines.push("");
  }

  lines.push("## Per Worksheet");
  if (!dailyReport.worksheets.length) {
    lines.push("- No worksheet data parsed.");
  }

  dailyReport.worksheets.forEach((worksheet) => {
    lines.push("");
    lines.push(`### ${worksheet.documentName} / ${worksheet.worksheetTitle} (${worksheet.currency})`);
    lines.push(...sectionSnapshot(worksheet.analysis, worksheet.currency));
  });

  if (dailyReport.failures.length) {
    lines.push("");
    lines.push("## Fetch/Parse Failures");
    dailyReport.failures.forEach((item) => lines.push(`- ${item}`));
  }

  if (dailyReport.markets?.length) {
    lines.push("");
    lines.push("## Market Views");
    dailyReport.markets.forEach((item) => {
      lines.push("");
      lines.push(`### ${item.market} (${item.currency})`);
      lines.push(...sectionSnapshot(item.analysis, item.currency));
    });
  }

  return `${lines.join("\n")}\n`;
}

export async function writeReports(dailyReport, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const markdownPath = path.join(outputDir, `${dailyReport.date}.md`);
  const jsonPath = path.join(outputDir, `${dailyReport.date}.json`);
  await fs.writeFile(markdownPath, toMarkdown(dailyReport), "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(dailyReport, null, 2), "utf8");
  return { markdownPath, jsonPath };
}

export function printConsoleSummary(dailyReport, markdownPath, jsonPath) {
  let line;
  if (dailyReport.mixedCurrency) {
    const parts = dailyReport.combinedByCurrency.map((item) => {
      const c = item.analysis;
      return `${item.currency}: ${fmtCurrency(c.snapshot.totalMarketValue, item.currency)} (${c.positionCount} pos)`;
    });
    line = [`Date: ${dailyReport.date}`, "Mixed currencies", ...parts].join(" | ");
  } else {
    const c = dailyReport.combined;
    line = [
      `Date: ${dailyReport.date}`,
      `Positions: ${c.positionCount}`,
      `Market Value: ${fmtCurrency(c.snapshot.totalMarketValue, dailyReport.combinedCurrency || dailyReport.baseCurrency)}`,
      `P&L: ${fmtCurrency(c.snapshot.totalPnl, dailyReport.combinedCurrency || dailyReport.baseCurrency)} (${fmtPct(
        c.snapshot.totalPnlPct
      )})`,
      `Overweight: ${c.risk.overweightPositions.length}`,
      `Big Losers: ${c.risk.bigLosers.length}`
    ].join(" | ");
  }
  console.log(line);
  console.log(`Markdown: ${markdownPath}`);
  console.log(`JSON: ${jsonPath}`);
}
