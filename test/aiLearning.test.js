import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  _extractPredictions as extractPredictions,
  _normalizeAction as normalizeAction,
  _parseProb as parseProb,
  _computeAccuracy as computeAccuracy,
  _resolvePrediction as resolvePrediction,
  _horizonToDays as horizonToDays,
  updateLearningLedger,
  generateLearningContext,
  learningStatusSummary
} from "../src/aiLearning.js";
import {
  scorecardToMarkdown,
  scorecardToJson,
  writeScorecard
} from "../src/aiScorecard.js";

// ── Helper factories ──

function makeDailyReport(date, overrides = {}) {
  return {
    date,
    baseCurrency: "USD",
    combined: {
      positionCount: 3,
      snapshot: {
        totalSpent: 10000,
        totalMarketValue: 12000,
        totalPnl: 2000,
        totalPnlPct: 0.2
      },
      positions: [
        { symbol: "AAPL", quantity: 10, spent: 3000, marketValue: 3600, pnl: 600, pnlPct: 0.2 },
        { symbol: "BTC", quantity: 0.5, spent: 4000, marketValue: 5000, pnl: 1000, pnlPct: 0.25 },
        { symbol: "COMI", quantity: 100, spent: 3000, marketValue: 3400, pnl: 400, pnlPct: 0.1333 }
      ],
      ...overrides
    },
    combinedCurrency: "USD"
  };
}

function makeAiJson(wallets = [], scenarioMatrix = []) {
  return {
    wallets,
    scenarioMatrix
  };
}

function makeWallet(name, actions = [], scenarios = []) {
  return {
    walletName: name,
    actions,
    scenarios
  };
}

function makeAction(symbol, action, confidence = 0.7, horizon = "24h") {
  return {
    symbol,
    action,
    confidence,
    horizon,
    sizeChange: "+2%",
    triggerLevel: 150,
    stopLevel: 140
  };
}

// ── normalizeAction Tests ──

test("normalizeAction maps common action strings", () => {
  assert.equal(normalizeAction("BUY"), "BUY");
  assert.equal(normalizeAction("buy"), "BUY");
  assert.equal(normalizeAction("Buy More"), "BUY");
  assert.equal(normalizeAction("ADD"), "BUY");
  assert.equal(normalizeAction("SELL"), "SELL");
  assert.equal(normalizeAction("sell"), "SELL");
  assert.equal(normalizeAction("EXIT"), "SELL");
  assert.equal(normalizeAction("CLOSE"), "SELL");
  assert.equal(normalizeAction("HOLD"), "HOLD");
  assert.equal(normalizeAction("hold"), "HOLD");
  assert.equal(normalizeAction("MAINTAIN"), "HOLD");
  assert.equal(normalizeAction("KEEP"), "HOLD");
  assert.equal(normalizeAction("TRIM"), "TRIM");
  assert.equal(normalizeAction("REDUCE"), "TRIM");
  assert.equal(normalizeAction("LIGHTEN"), "TRIM");
  assert.equal(normalizeAction(null), "UNKNOWN");
  assert.equal(normalizeAction(""), "UNKNOWN");
  assert.equal(normalizeAction("SOMETHING_ELSE"), "UNKNOWN");
});

// ── parseProb Tests ──

test("parseProb handles various probability formats", () => {
  assert.equal(parseProb(0.75), 0.75);
  assert.equal(parseProb(75), 0.75);
  assert.equal(parseProb("75%"), 0.75);
  assert.equal(parseProb("~70%"), 0.7);
  assert.equal(parseProb("0.65"), 0.65);
  assert.equal(parseProb(null), null);
  assert.equal(parseProb(""), null);
  assert.equal(parseProb("no probability"), null);
});

// ── horizonToDays Tests ──

test("horizonToDays maps horizons correctly", () => {
  assert.equal(horizonToDays("24h"), 1);
  assert.equal(horizonToDays("1w"), 7);
  assert.equal(horizonToDays("2w"), 14);
  assert.equal(horizonToDays("1m"), 30);
  assert.equal(horizonToDays("unknown"), 1);
});

// ── extractPredictions Tests ──

test("extractPredictions from structured wallet data", () => {
  const aiData = makeAiJson([
    makeWallet("Thndr US / Sheet1", [
      makeAction("AAPL", "BUY", 0.75, "24h"),
      makeAction("MSFT", "HOLD", 0.6, "2w")
    ]),
    makeWallet("Thndr US / Crypto", [
      makeAction("BTC", "SELL", 0.55, "24h")
    ])
  ]);

  const preds = extractPredictions(aiData, "2026-02-15");
  assert.equal(preds.length, 3);

  const aapl = preds.find((p) => p.symbol === "AAPL");
  assert.ok(aapl);
  assert.equal(aapl.action, "BUY");
  assert.equal(aapl.confidence, 0.75);
  assert.equal(aapl.horizon, "24h");
  assert.equal(aapl.expectedDirection, "up");
  assert.equal(aapl.wallet, "Thndr US / Sheet1");
  assert.equal(aapl.resolved, false);
  assert.equal(aapl.outcome, null);

  const btc = preds.find((p) => p.symbol === "BTC");
  assert.ok(btc);
  assert.equal(btc.action, "SELL");
  assert.equal(btc.expectedDirection, "down");
});

test("extractPredictions from flat actions array", () => {
  const aiData = {
    actions: [
      { symbol: "AAPL", action: "BUY", confidence: 0.7, horizon: "24h" },
      { symbol: "TSLA", action: "TRIM", confidence: 0.6, horizon: "2w" }
    ]
  };

  const preds = extractPredictions(aiData, "2026-02-15");
  assert.equal(preds.length, 2);
  assert.equal(preds[0].symbol, "AAPL");
  assert.equal(preds[1].symbol, "TSLA");
  assert.equal(preds[1].action, "TRIM");
  assert.equal(preds[1].expectedDirection, "down");
});

test("extractPredictions handles scenario matrix", () => {
  const aiData = makeAiJson([], [
    { label: "bull", probability: 0.3, horizon: "2w" },
    { label: "base", probability: 0.5, horizon: "2w" },
    { label: "bear", probability: 0.2, horizon: "2w" }
  ]);

  const preds = extractPredictions(aiData, "2026-02-15");
  const scenarios = preds.filter((p) => p.action === "SCENARIO");
  assert.equal(scenarios.length, 3);

  const bull = scenarios.find((s) => s.scenarioLabel === "bull");
  assert.ok(bull);
  assert.equal(bull.confidence, 0.3);
  assert.equal(bull.expectedDirection, "up");
});

test("extractPredictions deduplicates", () => {
  const aiData = {
    wallets: [
      makeWallet("W1", [makeAction("AAPL", "BUY", 0.7, "24h")])
    ],
    actions: [
      { symbol: "AAPL", action: "BUY", confidence: 0.7, horizon: "24h" }
    ]
  };

  const preds = extractPredictions(aiData, "2026-02-15");
  // Should not have duplicates for same symbol+date+horizon+wallet
  const aaplPreds = preds.filter((p) => p.symbol === "AAPL");
  // One from wallet (wallet="W1"), one from actions (wallet="combined") — different wallets so both kept
  assert.equal(aaplPreds.length, 2);
});

test("extractPredictions handles empty/null input", () => {
  assert.deepEqual(extractPredictions(null, "2026-02-15"), []);
  assert.deepEqual(extractPredictions({}, "2026-02-15"), []);
  assert.deepEqual(extractPredictions(42, "2026-02-15"), []);
});

// ── resolvePrediction Tests ──

test("resolvePrediction marks correct BUY when price goes up", () => {
  const prediction = {
    date: "2026-02-14",
    symbol: "AAPL",
    wallet: "test",
    action: "BUY",
    confidence: 0.7,
    horizon: "24h",
    expectedDirection: "up",
    triggerLevel: 150,
    stopLevel: 140,
    resolved: false,
    outcome: null
  };

  const before = new Map([["AAPL", { symbol: "AAPL", marketValue: 3000, pnl: 300, pnlPct: 0.1, spent: 2700, quantity: 10 }]]);
  const after = new Map([["AAPL", { symbol: "AAPL", marketValue: 3300, pnl: 600, pnlPct: 0.2, spent: 2700, quantity: 10 }]]);

  const resolved = resolvePrediction(prediction, before, after, "2026-02-15");
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.outcome.correct, true);
  assert.equal(resolved.outcome.actualDirection, "up");
  assert.ok(resolved.outcome.pnlPctChange > 0);
});

test("resolvePrediction marks incorrect BUY when price goes down", () => {
  const prediction = {
    date: "2026-02-14",
    symbol: "AAPL",
    wallet: "test",
    action: "BUY",
    confidence: 0.7,
    horizon: "24h",
    expectedDirection: "up",
    triggerLevel: 150,
    stopLevel: 140,
    resolved: false,
    outcome: null
  };

  const before = new Map([["AAPL", { symbol: "AAPL", marketValue: 3000, pnl: 300, pnlPct: 0.1, spent: 2700, quantity: 10 }]]);
  const after = new Map([["AAPL", { symbol: "AAPL", marketValue: 2700, pnl: 0, pnlPct: -0.05, spent: 2700, quantity: 10 }]]);

  const resolved = resolvePrediction(prediction, before, after, "2026-02-15");
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.outcome.correct, false);
  assert.equal(resolved.outcome.actualDirection, "down");
});

test("resolvePrediction marks SELL correct when price goes down", () => {
  const prediction = {
    date: "2026-02-14",
    symbol: "TSLA",
    wallet: "test",
    action: "SELL",
    confidence: 0.6,
    horizon: "24h",
    expectedDirection: "down",
    triggerLevel: null,
    stopLevel: null,
    resolved: false,
    outcome: null
  };

  const before = new Map([["TSLA", { symbol: "TSLA", marketValue: 5000, pnl: 500, pnlPct: 0.1, spent: 4500, quantity: 20 }]]);
  const after = new Map([["TSLA", { symbol: "TSLA", marketValue: 4500, pnl: 0, pnlPct: -0.02, spent: 4500, quantity: 20 }]]);

  const resolved = resolvePrediction(prediction, before, after, "2026-02-15");
  assert.equal(resolved.outcome.correct, true);
  assert.equal(resolved.outcome.actualDirection, "down");
});

test("resolvePrediction handles HOLD correctly", () => {
  const prediction = {
    date: "2026-02-14",
    symbol: "AAPL",
    wallet: "test",
    action: "HOLD",
    confidence: 0.8,
    horizon: "24h",
    expectedDirection: "flat",
    triggerLevel: null,
    stopLevel: null,
    resolved: false,
    outcome: null
  };

  // Price stays flat or goes up — HOLD is correct
  const before = new Map([["AAPL", { symbol: "AAPL", marketValue: 3000, pnl: 300, pnlPct: 0.1, spent: 2700, quantity: 10 }]]);
  const after = new Map([["AAPL", { symbol: "AAPL", marketValue: 3010, pnl: 310, pnlPct: 0.103, spent: 2700, quantity: 10 }]]);

  const resolved = resolvePrediction(prediction, before, after, "2026-02-15");
  assert.equal(resolved.outcome.correct, true);
});

test("resolvePrediction skips already resolved", () => {
  const prediction = {
    resolved: true,
    outcome: { correct: true }
  };
  const result = resolvePrediction(prediction, new Map(), new Map(), "2026-02-15");
  assert.equal(result, prediction); // same reference, unchanged
});

test("resolvePrediction handles unknown symbol gracefully", () => {
  const prediction = {
    date: "2026-02-14",
    symbol: "XYZ",
    wallet: "test",
    action: "BUY",
    confidence: 0.5,
    horizon: "24h",
    expectedDirection: "up",
    resolved: false,
    outcome: null
  };

  const result = resolvePrediction(prediction, new Map(), new Map(), "2026-02-15");
  assert.equal(result.resolved, false); // Cannot resolve without data
});

// ── computeAccuracy Tests ──

test("computeAccuracy with no predictions", () => {
  const acc = computeAccuracy([]);
  assert.equal(acc.totalPredictions, 0);
  assert.equal(acc.resolvedCount, 0);
  assert.equal(acc.overall, null);
});

test("computeAccuracy with resolved predictions", () => {
  const predictions = [
    { action: "BUY", horizon: "24h", wallet: "W1", symbol: "AAPL", resolved: true, outcome: { correct: true }, confidence: 0.7 },
    { action: "BUY", horizon: "24h", wallet: "W1", symbol: "MSFT", resolved: true, outcome: { correct: false }, confidence: 0.6 },
    { action: "SELL", horizon: "2w", wallet: "W2", symbol: "BTC", resolved: true, outcome: { correct: true }, confidence: 0.8 },
    { action: "HOLD", horizon: "24h", wallet: "W1", symbol: "GOOG", resolved: false, outcome: null, confidence: 0.5 }
  ];

  const acc = computeAccuracy(predictions);
  assert.equal(acc.totalPredictions, 4);
  assert.equal(acc.resolvedCount, 3);
  assert.equal(acc.unresolvedCount, 1);
  // 2 correct out of 3 resolved = 0.6667
  assert.ok(Math.abs(acc.overall - 0.6667) < 0.001);

  // BUY: 1/2 = 0.5
  assert.equal(acc.byAction.BUY.total, 2);
  assert.equal(acc.byAction.BUY.correct, 1);
  assert.ok(Math.abs(acc.byAction.BUY.accuracy - 0.5) < 0.001);

  // SELL: 1/1 = 1.0
  assert.equal(acc.byAction.SELL.accuracy, 1);

  // By wallet
  assert.equal(acc.byWallet.W1.total, 2);
  assert.equal(acc.byWallet.W2.total, 1);

  // By horizon
  assert.equal(acc.byHorizon["24h"].total, 2);
  assert.equal(acc.byHorizon["2w"].total, 1);
});

test("computeAccuracy calibration bucketing", () => {
  const predictions = [
    { confidence: 0.7, resolved: true, outcome: { correct: true }, action: "BUY", horizon: "24h", wallet: "W", symbol: "A" },
    { confidence: 0.7, resolved: true, outcome: { correct: true }, action: "BUY", horizon: "24h", wallet: "W", symbol: "B" },
    { confidence: 0.7, resolved: true, outcome: { correct: false }, action: "BUY", horizon: "24h", wallet: "W", symbol: "C" },
    { confidence: 0.3, resolved: true, outcome: { correct: false }, action: "SELL", horizon: "24h", wallet: "W", symbol: "D" },
    { confidence: 0.3, resolved: true, outcome: { correct: false }, action: "SELL", horizon: "24h", wallet: "W", symbol: "E" }
  ];

  const acc = computeAccuracy(predictions);
  assert.ok(acc.calibration.length > 0);

  const band07 = acc.calibration.find((c) => Math.abs(c.predictedProb - 0.7) < 0.05);
  assert.ok(band07);
  assert.equal(band07.sampleSize, 3);
  // 2/3 correct at 0.7 confidence
  assert.ok(Math.abs(band07.actualRate - 0.6667) < 0.001);

  const band03 = acc.calibration.find((c) => Math.abs(c.predictedProb - 0.3) < 0.05);
  assert.ok(band03);
  assert.equal(band03.sampleSize, 2);
  assert.equal(band03.actualRate, 0);
});

// ── updateLearningLedger Integration Tests ──

test("updateLearningLedger creates ledger from scratch", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-learn-"));

  // Write a factual report for day 1
  const report1 = makeDailyReport("2026-02-13");
  await fs.writeFile(path.join(tempDir, "2026-02-13.json"), JSON.stringify(report1));

  // Write an AI analysis for day 1
  const ai1 = makeAiJson([
    makeWallet("W1", [
      makeAction("AAPL", "BUY", 0.7, "24h"),
      makeAction("BTC", "HOLD", 0.6, "24h")
    ])
  ]);
  await fs.writeFile(path.join(tempDir, "2026-02-13.ai.json"), JSON.stringify(ai1));

  // Write a factual report for day 2 (outcome)
  const report2 = makeDailyReport("2026-02-14", {
    positions: [
      { symbol: "AAPL", quantity: 10, spent: 3000, marketValue: 3800, pnl: 800, pnlPct: 0.2667 },
      { symbol: "BTC", quantity: 0.5, spent: 4000, marketValue: 4900, pnl: 900, pnlPct: 0.225 },
      { symbol: "COMI", quantity: 100, spent: 3000, marketValue: 3400, pnl: 400, pnlPct: 0.1333 }
    ]
  });
  await fs.writeFile(path.join(tempDir, "2026-02-14.json"), JSON.stringify(report2));

  const { ledger, ledgerPath } = await updateLearningLedger(tempDir, "2026-02-14");

  assert.ok(ledger);
  assert.equal(ledger.version, 1);
  assert.equal(ledger.lastUpdated, "2026-02-14");
  assert.ok(ledger.predictions.length >= 2);

  // Check that predictions were extracted
  const aaplPred = ledger.predictions.find((p) => p.symbol === "AAPL" && p.action === "BUY");
  assert.ok(aaplPred);

  // Check that some were resolved
  const resolvedCount = ledger.predictions.filter((p) => p.resolved).length;
  assert.ok(resolvedCount > 0, `Expected some resolved predictions, got ${resolvedCount}`);

  // Check accuracy was computed
  assert.ok(ledger.accuracy);

  // Check ledger file was written
  const ledgerFile = await fs.readFile(ledgerPath, "utf8");
  const savedLedger = JSON.parse(ledgerFile);
  assert.equal(savedLedger.version, 1);
});

test("updateLearningLedger preserves existing predictions on re-run", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-learn-rerun-"));

  const report1 = makeDailyReport("2026-02-13");
  await fs.writeFile(path.join(tempDir, "2026-02-13.json"), JSON.stringify(report1));

  const ai1 = makeAiJson([makeWallet("W1", [makeAction("AAPL", "BUY", 0.7, "24h")])]);
  await fs.writeFile(path.join(tempDir, "2026-02-13.ai.json"), JSON.stringify(ai1));

  const report2 = makeDailyReport("2026-02-14");
  await fs.writeFile(path.join(tempDir, "2026-02-14.json"), JSON.stringify(report2));

  // Run twice
  await updateLearningLedger(tempDir, "2026-02-14");
  const { ledger } = await updateLearningLedger(tempDir, "2026-02-14");

  // Should not duplicate predictions
  const aaplPreds = ledger.predictions.filter((p) => p.symbol === "AAPL" && p.date === "2026-02-13");
  assert.equal(aaplPreds.length, 1);
});

test("updateLearningLedger handles no AI files gracefully", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-learn-empty-"));

  const report1 = makeDailyReport("2026-02-13");
  await fs.writeFile(path.join(tempDir, "2026-02-13.json"), JSON.stringify(report1));

  const { ledger } = await updateLearningLedger(tempDir, "2026-02-13");
  assert.equal(ledger.predictions.length, 0);
  assert.equal(ledger.accuracy.resolvedCount, 0);
});

// ── generateLearningContext Tests ──

test("generateLearningContext with no data", () => {
  const ctx = generateLearningContext(null);
  assert.ok(ctx.includes("No prior AI predictions"));
});

test("generateLearningContext with empty ledger", () => {
  const ledger = {
    accuracy: { resolvedCount: 0, totalPredictions: 0 },
    insights: [],
    recommendations: [],
    dailyScores: []
  };
  const ctx = generateLearningContext(ledger);
  assert.ok(ctx.includes("No prior AI predictions"));
});

test("generateLearningContext with real data", () => {
  const ledger = {
    accuracy: {
      totalPredictions: 10,
      resolvedCount: 8,
      unresolvedCount: 2,
      overall: 0.625,
      byAction: {
        BUY: { total: 5, correct: 3, accuracy: 0.6 },
        SELL: { total: 3, correct: 2, accuracy: 0.6667 }
      },
      byWallet: {
        "US Equities": { total: 4, correct: 3, accuracy: 0.75 },
        "Crypto": { total: 4, correct: 2, accuracy: 0.5 }
      },
      byHorizon: {},
      bySymbol: {},
      calibration: [
        { predictedProb: 0.7, actualRate: 0.6, gap: 0.1, sampleSize: 5 }
      ]
    },
    insights: [
      "Overall accuracy is moderate at 63%.",
      "BUY recommendations have 60% accuracy."
    ],
    recommendations: [
      { priority: "high", category: "calibration", recommendation: "Adjust confidence levels." }
    ],
    predictions: [],
    dailyScores: [
      { date: "2026-02-13", accuracy: 0.5, correct: 2, total: 4 },
      { date: "2026-02-14", accuracy: 0.75, correct: 3, total: 4 },
      { date: "2026-02-15", accuracy: 0.6, correct: 3, total: 5 }
    ]
  };

  const ctx = generateLearningContext(ledger);
  assert.ok(ctx.includes("Self-Learning Context"));
  assert.ok(ctx.includes("62.5%"));
  assert.ok(ctx.includes("BUY"));
  assert.ok(ctx.includes("US Equities"));
  assert.ok(ctx.includes("Crypto"));
  assert.ok(ctx.includes("Key Insights"));
  assert.ok(ctx.includes("Self-Improvement Directives"));
  assert.ok(ctx.includes("Daily Accuracy Trend"));
});

// ── learningStatusSummary Tests ──

test("learningStatusSummary with no data", () => {
  const summary = learningStatusSummary(null);
  assert.ok(summary.includes("No data"));
});

test("learningStatusSummary with data", () => {
  const ledger = {
    accuracy: {
      totalPredictions: 10,
      resolvedCount: 8,
      overall: 0.75
    },
    insights: ["foo", "bar"]
  };
  const summary = learningStatusSummary(ledger);
  assert.ok(summary.includes("Predictions: 10"));
  assert.ok(summary.includes("Resolved: 8"));
  assert.ok(summary.includes("75%"));
  assert.ok(summary.includes("Insights: 2"));
});

// ── Scorecard Tests ──

test("scorecardToMarkdown with no resolved predictions", () => {
  const ledger = {
    accuracy: { resolvedCount: 0 },
    insights: [],
    recommendations: [],
    dailyScores: [],
    predictions: []
  };
  const md = scorecardToMarkdown(ledger, "2026-02-15");
  assert.ok(md.includes("AI Prediction Scorecard"));
  assert.ok(md.includes("No predictions have been resolved"));
});

test("scorecardToMarkdown with resolved predictions", () => {
  const ledger = {
    accuracy: {
      totalPredictions: 10,
      resolvedCount: 8,
      unresolvedCount: 2,
      overall: 0.75,
      byAction: {
        BUY: { total: 5, correct: 4, accuracy: 0.8 },
        SELL: { total: 3, correct: 2, accuracy: 0.6667 }
      },
      byWallet: {
        "W1": { total: 5, correct: 4, accuracy: 0.8 },
        "W2": { total: 3, correct: 2, accuracy: 0.6667 }
      },
      byHorizon: {
        "24h": { total: 6, correct: 5, accuracy: 0.8333 },
        "2w": { total: 2, correct: 1, accuracy: 0.5 }
      },
      bySymbol: {
        "AAPL": { total: 4, correct: 3, accuracy: 0.75 },
        "BTC": { total: 4, correct: 3, accuracy: 0.75 }
      },
      calibration: [
        { predictedProb: 0.7, actualRate: 0.65, gap: 0.05, sampleSize: 6 },
        { predictedProb: 0.5, actualRate: 0.5, gap: 0, sampleSize: 2 }
      ]
    },
    insights: ["Overall accuracy is good at 75%."],
    recommendations: [{ priority: "high", category: "calibration", recommendation: "Fine-tune confidence." }],
    dailyScores: [
      { date: "2026-02-14", accuracy: 0.8, correct: 4, total: 5 },
      { date: "2026-02-15", accuracy: 0.7, correct: 3.5, total: 5 }
    ],
    predictions: [
      { date: "2026-02-14", symbol: "AAPL", action: "BUY", expectedDirection: "up", resolved: true, outcome: { correct: true, actualDirection: "up", pnlPctChange: 0.05 } },
      { date: "2026-02-14", symbol: "BTC", action: "SELL", expectedDirection: "down", resolved: true, outcome: { correct: false, actualDirection: "up", pnlPctChange: 0.02 } }
    ]
  };

  const md = scorecardToMarkdown(ledger, "2026-02-15");
  assert.ok(md.includes("Overall Performance"));
  assert.ok(md.includes("75.0%"));
  assert.ok(md.includes("Accuracy by Action Type"));
  assert.ok(md.includes("BUY"));
  assert.ok(md.includes("SELL"));
  assert.ok(md.includes("Accuracy by Wallet"));
  assert.ok(md.includes("Per-Symbol Accuracy"));
  assert.ok(md.includes("Confidence Calibration"));
  assert.ok(md.includes("Daily Accuracy Trend"));
  assert.ok(md.includes("Insights"));
  assert.ok(md.includes("Self-Improvement Recommendations"));
  assert.ok(md.includes("Recent Prediction Outcomes"));
});

test("scorecardToJson returns expected structure", () => {
  const ledger = {
    accuracy: { totalPredictions: 5, resolvedCount: 3, overall: 0.6667 },
    insights: ["test insight"],
    recommendations: [],
    dailyScores: [],
    predictions: [1, 2, 3, 4, 5]
  };

  const json = scorecardToJson(ledger, "2026-02-15");
  assert.equal(json.date, "2026-02-15");
  assert.equal(json.accuracy.overall, 0.6667);
  assert.equal(json.insights.length, 1);
  assert.equal(json.predictionCount, 5);
  assert.equal(json.resolvedCount, 3);
});

test("writeScorecard creates files on disk", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scorecard-"));

  const ledger = {
    accuracy: { resolvedCount: 0 },
    insights: [],
    recommendations: [],
    dailyScores: [],
    predictions: []
  };

  const { mdPath, jsonPath } = await writeScorecard(ledger, tempDir, "2026-02-15");

  const mdContent = await fs.readFile(mdPath, "utf8");
  assert.ok(mdContent.includes("AI Prediction Scorecard"));

  const jsonContent = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  assert.equal(jsonContent.date, "2026-02-15");
});
