import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { computeHealthScore, healthScoreToMarkdown } from "../src/healthScore.js";
import { buildHistoricalTrends } from "../src/history.js";
import { buildDiffReport, diffToMarkdown } from "../src/diff.js";
import { toHtml } from "../src/htmlReport.js";

// --- Helpers ---

function makeAnalysis(overrides = {}) {
  return {
    label: "Test",
    rawPositionCount: 5,
    positionCount: 5,
    inactivePositionCount: 0,
    snapshot: {
      totalSpent: 10000,
      totalMarketValue: 12000,
      totalPnl: 2000,
      totalPnlPct: 0.2,
      topPositions: [
        { symbol: "AAA", marketValue: 3000, marketWeight: 0.25 },
        { symbol: "BBB", marketValue: 2500, marketWeight: 0.2083 },
        { symbol: "CCC", marketValue: 2500, marketWeight: 0.2083 }
      ],
      adjustments: { count: 0 }
    },
    risk: {
      overweightPositions: [],
      top3Concentration: 0.6666,
      top3ConcentrationBreached: false,
      bigLosers: [],
      weirdValues: []
    },
    positions: [
      { symbol: "AAA", quantity: 10, spent: 2500, marketValue: 3000, pnl: 500, pnlPct: 0.2 },
      { symbol: "BBB", quantity: 20, spent: 2000, marketValue: 2500, pnl: 500, pnlPct: 0.25 },
      { symbol: "CCC", quantity: 15, spent: 2000, marketValue: 2500, pnl: 500, pnlPct: 0.25 },
      { symbol: "DDD", quantity: 5, spent: 2000, marketValue: 2200, pnl: 200, pnlPct: 0.1 },
      { symbol: "EEE", quantity: 8, spent: 1500, marketValue: 1800, pnl: 300, pnlPct: 0.2 }
    ],
    inactivePositions: [],
    ...overrides
  };
}

function makeDailyReport(overrides = {}) {
  const analysis = makeAnalysis();
  return {
    date: "2026-02-15",
    baseCurrency: "USD",
    configUsed: {
      documentCount: 1,
      currencies: ["USD"],
      watchlistCount: 0,
      authMode: "api_key",
      risk: {
        maxPositionWeight: 0.2,
        top3ConcentrationWarn: 0.55,
        drawdownWarnPct: -0.15,
        takeProfitWarnPct: 0.25,
        minPositionWeight: 0.02
      }
    },
    failures: [],
    worksheets: [],
    markets: [],
    combined: analysis,
    combinedCurrency: "USD",
    combinedByCurrency: [{ currency: "USD", analysis }],
    mixedCurrency: false,
    ...overrides
  };
}

// --- Health Score Tests ---

test("computeHealthScore returns score between 0 and 100", () => {
  const report = makeDailyReport();
  const health = computeHealthScore(report);
  assert.ok(health.score >= 0 && health.score <= 100, `Score ${health.score} out of range`);
  assert.ok(health.label);
  assert.ok(health.bar);
  assert.ok(health.dimensions);
  assert.ok(health.dimensions.diversification >= 0 && health.dimensions.diversification <= 25);
  assert.ok(health.dimensions.riskExposure >= 0 && health.dimensions.riskExposure <= 25);
  assert.ok(health.dimensions.performance >= 0 && health.dimensions.performance <= 25);
  assert.ok(health.dimensions.dataQuality >= 0 && health.dimensions.dataQuality <= 25);
});

test("computeHealthScore gives higher score for well-diversified profitable portfolio", () => {
  const goodReport = makeDailyReport();
  const goodHealth = computeHealthScore(goodReport);

  const badAnalysis = makeAnalysis({
    snapshot: {
      totalSpent: 10000,
      totalMarketValue: 7000,
      totalPnl: -3000,
      totalPnlPct: -0.3,
      topPositions: [{ symbol: "AAA", marketValue: 7000, marketWeight: 1.0 }],
      adjustments: { count: 0 }
    },
    positions: [{ symbol: "AAA", quantity: 10, spent: 10000, marketValue: 7000, pnl: -3000, pnlPct: -0.3 }],
    positionCount: 1,
    risk: {
      overweightPositions: [{ symbol: "AAA", marketWeight: 1.0 }],
      top3Concentration: 1.0,
      top3ConcentrationBreached: true,
      bigLosers: [{ symbol: "AAA", pnlPct: -0.3, pnl: -3000 }],
      weirdValues: ["bad data 1", "bad data 2"]
    }
  });
  const badReport = makeDailyReport({ combined: badAnalysis });
  const badHealth = computeHealthScore(badReport);

  assert.ok(goodHealth.score > badHealth.score, `Good: ${goodHealth.score} should be > Bad: ${badHealth.score}`);
});

test("computeHealthScore handles null combined", () => {
  const report = makeDailyReport({ combined: null });
  const health = computeHealthScore(report);
  assert.equal(health.score, 0);
  assert.equal(health.label, "No Data");
});

test("healthScoreToMarkdown contains expected sections", () => {
  const report = makeDailyReport();
  const health = computeHealthScore(report);
  const md = healthScoreToMarkdown(health);
  assert.match(md, /Portfolio Health Score/);
  assert.match(md, /Diversification/);
  assert.match(md, /Risk Exposure/);
  assert.match(md, /Performance/);
  assert.match(md, /Data Quality/);
});

// --- Historical Trends Tests ---

test("buildHistoricalTrends returns unavailable when no reports exist", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "history-empty-"));
  const result = await buildHistoricalTrends(tempDir, "2026-02-15");
  assert.equal(result.available, false);
});

test("buildHistoricalTrends computes trends from multiple reports", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "history-multi-"));

  const report1 = makeDailyReport({ date: "2026-02-13" });
  const report2 = makeDailyReport({ date: "2026-02-14" });
  report2.combined.snapshot.totalMarketValue = 12500;
  report2.combined.snapshot.totalPnl = 2500;
  report2.combined.positions = [
    ...report2.combined.positions.map((p) => ({ ...p, marketValue: p.marketValue + 100, pnl: p.pnl + 100 }))
  ];
  const report3 = makeDailyReport({ date: "2026-02-15" });
  report3.combined.snapshot.totalMarketValue = 13000;
  report3.combined.snapshot.totalPnl = 3000;

  await fs.writeFile(path.join(tempDir, "2026-02-13.json"), JSON.stringify(report1));
  await fs.writeFile(path.join(tempDir, "2026-02-14.json"), JSON.stringify(report2));
  await fs.writeFile(path.join(tempDir, "2026-02-15.json"), JSON.stringify(report3));

  const result = await buildHistoricalTrends(tempDir, "2026-02-15");
  assert.equal(result.available, true);
  assert.equal(result.datesUsed.length, 3);
  assert.ok(result.positions.length > 0);
  assert.ok(result.portfolio.dataPoints === 3);
  assert.ok(result.portfolio.trend === "uptrend");
});

// --- Diff Report Tests ---

test("buildDiffReport returns unavailable when no previous report", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-empty-"));
  const result = await buildDiffReport(tempDir, "2026-02-15");
  assert.equal(result.available, false);
});

test("buildDiffReport detects new and closed positions", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-changes-"));

  const report1 = makeDailyReport({ date: "2026-02-14" });
  const report2 = makeDailyReport({ date: "2026-02-15" });

  // Add a new position in report2 and remove one from report1
  report2.combined.positions = [
    ...report2.combined.positions.filter((p) => p.symbol !== "EEE"),
    { symbol: "FFF", quantity: 10, spent: 1000, marketValue: 1200, pnl: 200, pnlPct: 0.2 }
  ];

  await fs.writeFile(path.join(tempDir, "2026-02-14.json"), JSON.stringify(report1));
  await fs.writeFile(path.join(tempDir, "2026-02-15.json"), JSON.stringify(report2));

  const diff = await buildDiffReport(tempDir, "2026-02-15");
  assert.equal(diff.available, true);
  assert.equal(diff.previousDate, "2026-02-14");
  assert.equal(diff.newPositions.length, 1);
  assert.equal(diff.newPositions[0].symbol, "FFF");
  assert.equal(diff.closedPositions.length, 1);
  assert.equal(diff.closedPositions[0].symbol, "EEE");
});

test("buildDiffReport computes portfolio delta", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-delta-"));

  const report1 = makeDailyReport({ date: "2026-02-14" });
  const report2 = makeDailyReport({ date: "2026-02-15" });
  report2.combined.snapshot.totalMarketValue = 13000;
  report2.combined.snapshot.totalPnl = 3000;
  report2.combined.snapshot.totalPnlPct = 0.3;

  await fs.writeFile(path.join(tempDir, "2026-02-14.json"), JSON.stringify(report1));
  await fs.writeFile(path.join(tempDir, "2026-02-15.json"), JSON.stringify(report2));

  const diff = await buildDiffReport(tempDir, "2026-02-15");
  assert.equal(diff.portfolioDelta.marketValueBefore, 12000);
  assert.equal(diff.portfolioDelta.marketValueAfter, 13000);
  assert.equal(diff.portfolioDelta.marketValueDelta, 1000);
});

test("diffToMarkdown renders formatted output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diff-md-"));

  const report1 = makeDailyReport({ date: "2026-02-14" });
  const report2 = makeDailyReport({ date: "2026-02-15" });

  await fs.writeFile(path.join(tempDir, "2026-02-14.json"), JSON.stringify(report1));
  await fs.writeFile(path.join(tempDir, "2026-02-15.json"), JSON.stringify(report2));

  const diff = await buildDiffReport(tempDir, "2026-02-15");
  const md = diffToMarkdown(diff, "USD");
  assert.match(md, /Day-over-Day Changes/);
  assert.match(md, /Portfolio Delta/);
});

test("diffToMarkdown handles unavailable diff", () => {
  const md = diffToMarkdown({ available: false, reason: "no data" });
  assert.match(md, /unavailable/);
});

// --- HTML Report Tests ---

test("toHtml generates valid HTML with required sections", () => {
  const report = makeDailyReport();
  const health = computeHealthScore(report);
  const html = toHtml(report, health);

  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Portfolio Report/);
  assert.match(html, /2026-02-15/);
  assert.match(html, /treemap/);
  assert.match(html, /All Positions/);
  assert.match(html, /Wallets/);
  // Health gauge should be present
  assert.match(html, /health-gauge/);
  assert.match(html, /gauge-circle/);
});

test("toHtml works without optional enrichments", () => {
  const report = makeDailyReport();
  const html = toHtml(report);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /Portfolio Report/);
});

test("toHtml includes diff section when provided", () => {
  const report = makeDailyReport();
  const diff = {
    available: true,
    currentDate: "2026-02-15",
    previousDate: "2026-02-14",
    portfolioDelta: {
      marketValueBefore: 12000,
      marketValueAfter: 13000,
      marketValueDelta: 1000,
      pnlBefore: 2000,
      pnlAfter: 3000,
      pnlDelta: 1000,
      pnlPctBefore: 0.2,
      pnlPctAfter: 0.3,
      pnlPctDelta: 0.1,
      positionCountBefore: 5,
      positionCountAfter: 5
    },
    newPositions: [{ symbol: "FFF", marketValue: 1200, weight: 0.1, pnl: 200 }],
    closedPositions: [],
    changes: []
  };

  const html = toHtml(report, null, diff);
  assert.match(html, /Day-over-Day Changes/);
  assert.match(html, /FFF/);
});

test("toHtml escapes HTML in symbol names", () => {
  const report = makeDailyReport();
  report.combined.positions = [
    { symbol: "<script>alert(1)</script>", quantity: 1, spent: 100, marketValue: 120, pnl: 20, pnlPct: 0.2 }
  ];
  const html = toHtml(report);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
