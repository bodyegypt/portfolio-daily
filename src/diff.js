import fs from "node:fs/promises";
import path from "node:path";

/**
 * Day-over-Day Diff Report
 *
 * Compares two daily reports and produces a structured changelog:
 * - New positions entered
 * - Positions exited (closed)
 * - Weight shifts (largest movers)
 * - P&L swings
 * - Portfolio-level delta
 */

async function loadReport(reportsDir, date) {
  const filePath = path.join(reportsDir, `${date}.json`);
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function findPreviousDate(reportsDir, currentDate) {
  let entries;
  try {
    entries = await fs.readdir(reportsDir);
  } catch {
    return null;
  }
  const dates = entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .filter((d) => d < currentDate)
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

function positionMap(report) {
  const map = new Map();
  if (!report?.combined?.positions) return map;
  const totalMV = report.combined.snapshot?.totalMarketValue ?? 1;
  for (const pos of report.combined.positions) {
    const weight = totalMV > 0 ? (pos.marketValue ?? 0) / totalMV : 0;
    map.set(pos.symbol, {
      symbol: pos.symbol,
      marketValue: pos.marketValue ?? 0,
      pnl: pos.pnl ?? 0,
      pnlPct: pos.pnlPct ?? 0,
      spent: pos.spent ?? 0,
      quantity: pos.quantity ?? 0,
      weight: round4(weight)
    });
  }
  return map;
}

function round4(v) {
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 10000) / 10000;
}

export async function buildDiffReport(reportsDir, currentDate, compareDate = null) {
  const prevDate = compareDate ?? (await findPreviousDate(reportsDir, currentDate));
  if (!prevDate) {
    return { available: false, reason: "no previous report found" };
  }

  const [currentReport, previousReport] = await Promise.all([
    loadReport(reportsDir, currentDate),
    loadReport(reportsDir, prevDate)
  ]);

  if (!currentReport || !previousReport) {
    return { available: false, reason: "could not load one or both reports" };
  }

  const currMap = positionMap(currentReport);
  const prevMap = positionMap(previousReport);
  const allSymbols = new Set([...currMap.keys(), ...prevMap.keys()]);

  const newPositions = [];
  const closedPositions = [];
  const changes = [];

  for (const symbol of allSymbols) {
    const curr = currMap.get(symbol);
    const prev = prevMap.get(symbol);

    if (curr && !prev) {
      newPositions.push({
        symbol,
        marketValue: curr.marketValue,
        weight: curr.weight,
        pnl: curr.pnl
      });
    } else if (!curr && prev) {
      closedPositions.push({
        symbol,
        lastMarketValue: prev.marketValue,
        lastWeight: prev.weight,
        finalPnl: prev.pnl
      });
    } else if (curr && prev) {
      const weightDelta = round4((curr.weight ?? 0) - (prev.weight ?? 0));
      const pnlDelta = round4((curr.pnl ?? 0) - (prev.pnl ?? 0));
      const mvDelta = round4((curr.marketValue ?? 0) - (prev.marketValue ?? 0));
      const pnlPctDelta = round4((curr.pnlPct ?? 0) - (prev.pnlPct ?? 0));

      changes.push({
        symbol,
        weightBefore: prev.weight,
        weightAfter: curr.weight,
        weightDelta,
        pnlBefore: prev.pnl,
        pnlAfter: curr.pnl,
        pnlDelta,
        pnlPctDelta,
        mvDelta
      });
    }
  }

  // Sort by absolute weight change
  changes.sort((a, b) => Math.abs(b.weightDelta ?? 0) - Math.abs(a.weightDelta ?? 0));

  // Portfolio-level delta
  const currSnap = currentReport.combined?.snapshot ?? {};
  const prevSnap = previousReport.combined?.snapshot ?? {};

  const portfolioDelta = {
    marketValueBefore: prevSnap.totalMarketValue ?? 0,
    marketValueAfter: currSnap.totalMarketValue ?? 0,
    marketValueDelta: round4((currSnap.totalMarketValue ?? 0) - (prevSnap.totalMarketValue ?? 0)),
    pnlBefore: prevSnap.totalPnl ?? 0,
    pnlAfter: currSnap.totalPnl ?? 0,
    pnlDelta: round4((currSnap.totalPnl ?? 0) - (prevSnap.totalPnl ?? 0)),
    pnlPctBefore: prevSnap.totalPnlPct ?? 0,
    pnlPctAfter: currSnap.totalPnlPct ?? 0,
    pnlPctDelta: round4((currSnap.totalPnlPct ?? 0) - (prevSnap.totalPnlPct ?? 0)),
    positionCountBefore: previousReport.combined?.positionCount ?? 0,
    positionCountAfter: currentReport.combined?.positionCount ?? 0
  };

  return {
    available: true,
    currentDate,
    previousDate: prevDate,
    portfolioDelta,
    newPositions,
    closedPositions,
    changes: changes.slice(0, 20),
    biggestWeightGainers: changes.filter((c) => (c.weightDelta ?? 0) > 0).slice(0, 5),
    biggestWeightLosers: changes.filter((c) => (c.weightDelta ?? 0) < 0).slice(0, 5),
    biggestPnlGainers: [...changes].sort((a, b) => (b.pnlDelta ?? 0) - (a.pnlDelta ?? 0)).slice(0, 5),
    biggestPnlLosers: [...changes].sort((a, b) => (a.pnlDelta ?? 0) - (b.pnlDelta ?? 0)).slice(0, 5)
  };
}

export function diffToMarkdown(diff, currency = "USD") {
  if (!diff.available) return `> Diff unavailable: ${diff.reason}\n`;

  const fmt = (v) => {
    if (!Number.isFinite(v)) return "n/a";
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
  };
  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return "n/a";
    return `${(v * 100).toFixed(2)}%`;
  };
  const sign = (v) => (v > 0 ? "+" : "");

  const lines = [];
  lines.push(`## Day-over-Day Changes (${diff.previousDate} -> ${diff.currentDate})`);
  lines.push("");

  // Portfolio delta
  const pd = diff.portfolioDelta;
  lines.push("### Portfolio Delta");
  lines.push(`- Market Value: ${fmt(pd.marketValueBefore)} -> ${fmt(pd.marketValueAfter)} (${sign(pd.marketValueDelta)}${fmt(pd.marketValueDelta)})`);
  lines.push(`- P&L: ${fmt(pd.pnlBefore)} -> ${fmt(pd.pnlAfter)} (${sign(pd.pnlDelta)}${fmt(pd.pnlDelta)})`);
  lines.push(`- P&L %: ${fmtPct(pd.pnlPctBefore)} -> ${fmtPct(pd.pnlPctAfter)} (${sign(pd.pnlPctDelta)}${fmtPct(pd.pnlPctDelta)})`);
  lines.push(`- Positions: ${pd.positionCountBefore} -> ${pd.positionCountAfter}`);
  lines.push("");

  // New positions
  if (diff.newPositions.length) {
    lines.push("### New Positions");
    for (const p of diff.newPositions) {
      lines.push(`- **${p.symbol}**: ${fmt(p.marketValue)} (weight: ${fmtPct(p.weight)})`);
    }
    lines.push("");
  }

  // Closed positions
  if (diff.closedPositions.length) {
    lines.push("### Closed Positions");
    for (const p of diff.closedPositions) {
      lines.push(`- **${p.symbol}**: final P&L ${fmt(p.finalPnl)}`);
    }
    lines.push("");
  }

  // Biggest movers
  if (diff.biggestPnlGainers.length) {
    lines.push("### Biggest P&L Gainers");
    for (const c of diff.biggestPnlGainers) {
      lines.push(`- **${c.symbol}**: ${sign(c.pnlDelta)}${fmt(c.pnlDelta)} (${sign(c.pnlPctDelta)}${fmtPct(c.pnlPctDelta)})`);
    }
    lines.push("");
  }

  if (diff.biggestPnlLosers.length) {
    lines.push("### Biggest P&L Losers");
    for (const c of diff.biggestPnlLosers) {
      lines.push(`- **${c.symbol}**: ${sign(c.pnlDelta)}${fmt(c.pnlDelta)} (${sign(c.pnlPctDelta)}${fmtPct(c.pnlPctDelta)})`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}
