import fs from "node:fs/promises";
import path from "node:path";

/**
 * Historical Trend Engine
 *
 * Reads past JSON reports from the reports directory and computes
 * multi-day trends, moving averages, and momentum per position.
 */

async function listReportDates(reportsDir) {
  let entries;
  try {
    entries = await fs.readdir(reportsDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .sort();
}

async function loadReport(reportsDir, date) {
  const filePath = path.join(reportsDir, `${date}.json`);
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractPositionMap(report) {
  const map = new Map();
  if (!report?.combined?.positions) return map;
  for (const pos of report.combined.positions) {
    map.set(pos.symbol, {
      symbol: pos.symbol,
      marketValue: pos.marketValue ?? 0,
      pnl: pos.pnl ?? 0,
      pnlPct: pos.pnlPct ?? 0,
      spent: pos.spent ?? 0
    });
  }
  return map;
}

function computeMovingAverage(values, window) {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

function computeMomentum(values) {
  if (values.length < 2) return 0;
  const recent = values[values.length - 1];
  const previous = values[values.length - 2];
  if (previous === 0) return 0;
  return (recent - previous) / Math.abs(previous);
}

function classifyTrend(values) {
  if (values.length < 3) return "insufficient_data";
  const recent3 = values.slice(-3);
  const allUp = recent3.every((v, i) => i === 0 || v >= recent3[i - 1]);
  const allDown = recent3.every((v, i) => i === 0 || v <= recent3[i - 1]);
  if (allUp) return "uptrend";
  if (allDown) return "downtrend";
  return "sideways";
}

export async function buildHistoricalTrends(reportsDir, currentDate, lookbackDays = 7) {
  const allDates = await listReportDates(reportsDir);
  const cutoff = allDates.filter((d) => d <= currentDate).slice(-lookbackDays);

  if (cutoff.length < 2) {
    return { available: false, reason: "fewer than 2 historical reports", dates: cutoff, positions: [], portfolio: [] };
  }

  const reports = [];
  for (const date of cutoff) {
    const report = await loadReport(reportsDir, date);
    if (report) reports.push({ date, report });
  }

  if (reports.length < 2) {
    return { available: false, reason: "could not load enough reports", dates: cutoff, positions: [], portfolio: [] };
  }

  // Track per-position history
  const symbolHistory = new Map();
  const portfolioHistory = [];

  for (const { date, report } of reports) {
    const posMap = extractPositionMap(report);
    for (const [symbol, data] of posMap) {
      if (!symbolHistory.has(symbol)) symbolHistory.set(symbol, []);
      symbolHistory.get(symbol).push({ date, ...data });
    }

    const combined = report.combined?.snapshot;
    if (combined) {
      portfolioHistory.push({
        date,
        totalMarketValue: combined.totalMarketValue ?? 0,
        totalPnl: combined.totalPnl ?? 0,
        totalPnlPct: combined.totalPnlPct ?? 0,
        positionCount: report.combined.positionCount ?? 0
      });
    }
  }

  // Compute per-position trends
  const positionTrends = [];
  for (const [symbol, history] of symbolHistory) {
    const pnlValues = history.map((h) => h.pnl);
    const mvValues = history.map((h) => h.marketValue);
    const pnlPctValues = history.map((h) => h.pnlPct);

    positionTrends.push({
      symbol,
      dataPoints: history.length,
      dates: history.map((h) => h.date),
      pnlHistory: pnlValues,
      pnlPctHistory: pnlPctValues,
      marketValueHistory: mvValues,
      trend: classifyTrend(pnlValues),
      momentum: round4(computeMomentum(mvValues)),
      movingAvgPnl3: round4(computeMovingAverage(pnlValues, 3)),
      movingAvgPnl5: round4(computeMovingAverage(pnlValues, 5)),
      latestPnl: pnlValues[pnlValues.length - 1] ?? null,
      latestPnlPct: pnlPctValues[pnlPctValues.length - 1] ?? null
    });
  }

  // Compute portfolio-level trends
  const mvValues = portfolioHistory.map((h) => h.totalMarketValue);
  const pnlValues = portfolioHistory.map((h) => h.totalPnl);
  const portfolioTrend = {
    dataPoints: portfolioHistory.length,
    dates: portfolioHistory.map((h) => h.date),
    marketValueHistory: mvValues,
    pnlHistory: pnlValues,
    trend: classifyTrend(mvValues),
    momentum: round4(computeMomentum(mvValues)),
    movingAvgMV3: round4(computeMovingAverage(mvValues, 3)),
    movingAvgMV5: round4(computeMovingAverage(mvValues, 5))
  };

  return {
    available: true,
    lookbackDays,
    datesUsed: reports.map((r) => r.date),
    positions: positionTrends.sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum)),
    portfolio: portfolioTrend
  };
}

function round4(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v * 10000) / 10000;
}
