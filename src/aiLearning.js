import fs from "node:fs/promises";
import path from "node:path";

/**
 * AI Learning Tracker
 *
 * Extracts structured predictions from AI analysis files (*.ai.json),
 * resolves them against actual outcomes from subsequent factual reports,
 * computes accuracy metrics, and maintains a cumulative learning ledger.
 */

const LEDGER_FILENAME = "ai-learning.json";

// ── Helpers ──────────────────────────────────────────────────────────

function round4(v) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.round(v * 10000) / 10000;
}

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

async function listAiDates(reportsDir) {
  let entries;
  try {
    entries = await fs.readdir(reportsDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.ai\.json$/.test(f))
    .map((f) => f.replace(".ai.json", ""))
    .sort();
}

async function loadJson(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function nextDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function findNextAvailableDate(allDates, afterDate) {
  return allDates.find((d) => d > afterDate) ?? null;
}

// ── Prediction Extraction ────────────────────────────────────────────

/**
 * Normalize action string to one of: BUY, SELL, HOLD, TRIM, UNKNOWN
 */
function normalizeAction(raw) {
  if (!raw) return "UNKNOWN";
  const upper = String(raw).toUpperCase().trim();
  if (upper.startsWith("BUY") || upper === "ADD") return "BUY";
  if (upper.startsWith("SELL") || upper === "EXIT" || upper === "CLOSE") return "SELL";
  if (upper.startsWith("HOLD") || upper === "MAINTAIN" || upper === "KEEP") return "HOLD";
  if (upper.startsWith("TRIM") || upper === "REDUCE" || upper === "LIGHTEN") return "TRIM";
  return "UNKNOWN";
}

/**
 * Extract a probability number from various formats:
 * "75%", 0.75, 75, "~70%", "70-80%"
 */
function parseProb(raw) {
  if (typeof raw === "number") return raw > 1 ? raw / 100 : raw;
  if (typeof raw !== "string") return null;
  const match = raw.match(/([\d.]+)/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;
  return num > 1 ? num / 100 : num;
}

/**
 * Extract structured predictions from an AI analysis JSON file.
 * Handles various output formats the AI might produce.
 */
export function extractPredictions(aiData, date) {
  const predictions = [];

  if (!aiData || typeof aiData !== "object") return predictions;

  // Strategy 1: Look for wallet-level action tables
  const walletKeys = findWalletSections(aiData);
  for (const { key, wallet, walletName } of walletKeys) {
    const actions = extractActionsFromWallet(wallet, walletName, date);
    predictions.push(...actions);
  }

  // Strategy 2: Look for a top-level "actions" or "recommendations" array
  for (const field of ["actions", "recommendations", "actionPlan", "action_plan"]) {
    if (Array.isArray(aiData[field])) {
      for (const item of aiData[field]) {
        const pred = parseActionItem(item, date, "combined");
        if (pred) predictions.push(pred);
      }
    }
  }

  // Strategy 3: Look for scenario predictions
  const scenarios = extractScenarios(aiData, date);
  predictions.push(...scenarios);

  // Deduplicate by symbol+date+horizon+wallet (and scenario label for scenarios)
  const seen = new Set();
  return predictions.filter((p) => {
    const scenarioSuffix = p.scenarioLabel ? `:${p.scenarioLabel}` : "";
    const key = `${p.date}:${p.symbol}:${p.horizon}:${p.wallet}${scenarioSuffix}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findWalletSections(data) {
  const results = [];
  if (!data || typeof data !== "object") return results;

  // Check top-level keys that look like wallet sections
  for (const key of Object.keys(data)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("wallet") ||
      lower.includes("us_equit") ||
      lower.includes("crypto") ||
      lower.includes("egx") ||
      lower.includes("thndr") ||
      lower.includes("equities")
    ) {
      const val = data[key];
      if (val && typeof val === "object") {
        results.push({ key, wallet: val, walletName: key });
      }
    }
  }

  // Check nested "wallets" array
  if (Array.isArray(data.wallets)) {
    for (const w of data.wallets) {
      if (w && typeof w === "object") {
        const name = w.walletName || w.wallet || w.name || "unknown";
        results.push({ key: name, wallet: w, walletName: name });
      }
    }
  }

  return results;
}

function extractActionsFromWallet(wallet, walletName, date) {
  const actions = [];
  // Look for action arrays in various field names
  for (const field of [
    "actions", "actionPlan", "action_plan", "recommendations",
    "holdings", "positions", "holdingActions", "holding_actions"
  ]) {
    if (Array.isArray(wallet[field])) {
      for (const item of wallet[field]) {
        const pred = parseActionItem(item, date, walletName);
        if (pred) actions.push(pred);
      }
    }
  }

  // Look for scenario predictions within wallet
  if (wallet.scenarios || wallet.scenarioMatrix || wallet.scenario_matrix) {
    const scenarioData = wallet.scenarios || wallet.scenarioMatrix || wallet.scenario_matrix;
    const scenarios = extractWalletScenarios(scenarioData, date, walletName);
    actions.push(...scenarios);
  }

  return actions;
}

function parseActionItem(item, date, wallet) {
  if (!item || typeof item !== "object") return null;
  const symbol = String(item.symbol || item.ticker || item.name || "").toUpperCase().trim();
  if (!symbol) return null;

  const action = normalizeAction(item.action || item.actionNow || item.action_now || item.recommendation);
  const confidence = parseProb(item.confidence || item.probability || item.prob);
  const triggerLevel = parseFloat(item.triggerLevel || item.trigger || item.entry || item.triggerPrice) || null;
  const stopLevel = parseFloat(item.stopLevel || item.stop || item.invalidation || item.stopLoss) || null;

  // Determine expected direction from action
  let expectedDirection = null;
  if (action === "BUY") expectedDirection = "up";
  else if (action === "SELL" || action === "TRIM") expectedDirection = "down";
  else if (action === "HOLD") expectedDirection = "flat";

  return {
    date,
    symbol,
    wallet,
    action,
    confidence: round4(confidence),
    horizon: normalizeHorizon(item.horizon || item.timeframe || "24h"),
    expectedDirection,
    triggerLevel: Number.isFinite(triggerLevel) ? triggerLevel : null,
    stopLevel: Number.isFinite(stopLevel) ? stopLevel : null,
    sizeChangePct: parseProb(item.sizeChange || item.size_change || item.sizing) ?? null,
    resolved: false,
    outcome: null
  };
}

function normalizeHorizon(raw) {
  if (!raw) return "24h";
  const s = String(raw).toLowerCase().trim();
  if (s.includes("24") || s.includes("1 day") || s.includes("1d") || s.includes("day")) return "24h";
  if (s.includes("2 week") || s.includes("2w") || s.includes("14d") || s.includes("2-week")) return "2w";
  if (s.includes("1 week") || s.includes("1w") || s.includes("7d") || s.includes("week")) return "1w";
  if (s.includes("month") || s.includes("30d") || s.includes("4w")) return "1m";
  return "24h";
}

function horizonToDays(horizon) {
  switch (horizon) {
    case "24h": return 1;
    case "1w": return 7;
    case "2w": return 14;
    case "1m": return 30;
    default: return 1;
  }
}

function extractScenarios(data, date) {
  const predictions = [];
  const scenarioFields = ["scenarioMatrix", "scenario_matrix", "scenarios"];

  for (const field of scenarioFields) {
    if (data[field] && typeof data[field] === "object") {
      const scenarios = extractWalletScenarios(data[field], date, "portfolio");
      predictions.push(...scenarios);
    }
  }

  return predictions;
}

function extractWalletScenarios(scenarioData, date, wallet) {
  const predictions = [];
  if (!scenarioData || typeof scenarioData !== "object") return predictions;

  // Handle array of scenarios
  const scenarioList = Array.isArray(scenarioData) ? scenarioData : Object.values(scenarioData);

  for (const scenario of scenarioList) {
    if (!scenario || typeof scenario !== "object") continue;
    const label = String(scenario.name || scenario.label || scenario.scenario || "unknown").toLowerCase();
    const prob = parseProb(scenario.probability || scenario.prob || scenario.likelihood);

    if (prob !== null) {
      predictions.push({
        date,
        symbol: "__SCENARIO__",
        wallet,
        action: "SCENARIO",
        confidence: round4(prob),
        horizon: normalizeHorizon(scenario.horizon || scenario.timeframe || "2w"),
        expectedDirection: label.includes("bull") ? "up" : label.includes("bear") ? "down" : "flat",
        triggerLevel: null,
        stopLevel: null,
        sizeChangePct: null,
        scenarioLabel: label,
        resolved: false,
        outcome: null
      });
    }
  }

  return predictions;
}

// ── Outcome Resolution ──────────────────────────────────────────────

/**
 * Build a position map from a factual report: symbol -> { marketValue, pnl, pnlPct, ... }
 */
function buildPositionMap(report) {
  const map = new Map();
  if (!report?.combined?.positions) return map;
  for (const pos of report.combined.positions) {
    map.set(pos.symbol, {
      symbol: pos.symbol,
      marketValue: pos.marketValue ?? 0,
      pnl: pos.pnl ?? 0,
      pnlPct: pos.pnlPct ?? 0,
      spent: pos.spent ?? 0,
      quantity: pos.quantity ?? 0
    });
  }
  return map;
}

/**
 * Resolve a single prediction against before/after position data.
 */
function resolvePrediction(prediction, beforePositions, afterPositions, resolvedDate) {
  // Skip scenarios and already-resolved predictions
  if (prediction.resolved) return prediction;
  if (prediction.action === "SCENARIO") {
    return resolveScenarioPrediction(prediction, beforePositions, afterPositions, resolvedDate);
  }

  const before = beforePositions.get(prediction.symbol);
  const after = afterPositions.get(prediction.symbol);

  // Cannot resolve if symbol wasn't tracked in both periods
  if (!before && !after) return prediction;

  const beforePnlPct = before?.pnlPct ?? 0;
  const afterPnlPct = after?.pnlPct ?? 0;
  const pnlPctChange = round4(afterPnlPct - beforePnlPct);

  const beforeMV = before?.marketValue ?? 0;
  const afterMV = after?.marketValue ?? 0;
  const mvChange = round4(afterMV - beforeMV);

  let actualDirection;
  if (pnlPctChange > 0.005) actualDirection = "up";
  else if (pnlPctChange < -0.005) actualDirection = "down";
  else actualDirection = "flat";

  // Determine if prediction was correct
  let correct = false;
  if (prediction.expectedDirection === "up" && actualDirection === "up") correct = true;
  else if (prediction.expectedDirection === "down" && (actualDirection === "down" || !after)) correct = true;
  else if (prediction.expectedDirection === "flat" && actualDirection === "flat") correct = true;

  // For HOLD, it's correct if position didn't crash
  if (prediction.action === "HOLD" && actualDirection !== "down") correct = true;

  // Check if stop level was hit
  let stopHit = false;
  if (prediction.stopLevel && after) {
    const impliedPrice = after.quantity > 0 ? after.marketValue / after.quantity : 0;
    if (prediction.expectedDirection === "up" && impliedPrice < prediction.stopLevel) stopHit = true;
    if (prediction.expectedDirection === "down" && impliedPrice > prediction.stopLevel) stopHit = true;
  }

  return {
    ...prediction,
    resolved: true,
    outcome: {
      resolvedDate,
      actualDirection,
      pnlPctChange,
      mvChange,
      correct,
      stopHit,
      positionExited: !!before && !after,
      positionEntered: !before && !!after
    }
  };
}

function resolveScenarioPrediction(prediction, beforePositions, afterPositions, resolvedDate) {
  if (prediction.resolved) return prediction;

  // For portfolio scenarios, check overall direction
  let totalMvBefore = 0;
  let totalMvAfter = 0;
  for (const pos of beforePositions.values()) totalMvBefore += pos.marketValue;
  for (const pos of afterPositions.values()) totalMvAfter += pos.marketValue;

  const mvChange = totalMvAfter - totalMvBefore;
  const mvChangePct = totalMvBefore > 0 ? mvChange / totalMvBefore : 0;

  let actualDirection;
  if (mvChangePct > 0.005) actualDirection = "up";
  else if (mvChangePct < -0.005) actualDirection = "down";
  else actualDirection = "flat";

  const correct = prediction.expectedDirection === actualDirection;

  return {
    ...prediction,
    resolved: true,
    outcome: {
      resolvedDate,
      actualDirection,
      pnlPctChange: round4(mvChangePct),
      mvChange: round4(mvChange),
      correct,
      stopHit: false,
      positionExited: false,
      positionEntered: false
    }
  };
}

// ── Accuracy & Calibration ──────────────────────────────────────────

function computeAccuracy(predictions) {
  const resolved = predictions.filter((p) => p.resolved && p.outcome);
  if (resolved.length === 0) {
    return {
      totalPredictions: predictions.length,
      resolvedCount: 0,
      unresolvedCount: predictions.length,
      overall: null,
      byAction: {},
      byHorizon: {},
      byWallet: {},
      bySymbol: {},
      calibration: []
    };
  }

  const correct = resolved.filter((p) => p.outcome.correct);
  const overall = round4(correct.length / resolved.length);

  // Group by dimensions
  const byAction = groupAccuracy(resolved, (p) => p.action);
  const byHorizon = groupAccuracy(resolved, (p) => p.horizon);
  const byWallet = groupAccuracy(resolved, (p) => p.wallet);
  const bySymbol = groupAccuracy(resolved, (p) => p.symbol);

  // Calibration: bucket by confidence and compare predicted vs actual rate
  const calibration = computeCalibration(resolved);

  return {
    totalPredictions: predictions.length,
    resolvedCount: resolved.length,
    unresolvedCount: predictions.length - resolved.length,
    overall,
    byAction,
    byHorizon,
    byWallet,
    bySymbol,
    calibration
  };
}

function groupAccuracy(resolved, keyFn) {
  const groups = new Map();
  for (const p of resolved) {
    const key = keyFn(p);
    if (!groups.has(key)) groups.set(key, { total: 0, correct: 0 });
    const g = groups.get(key);
    g.total += 1;
    if (p.outcome.correct) g.correct += 1;
  }

  const result = {};
  for (const [key, g] of groups) {
    result[key] = {
      total: g.total,
      correct: g.correct,
      accuracy: round4(g.correct / g.total)
    };
  }
  return result;
}

function computeCalibration(resolved) {
  // Bucket predictions by confidence into 10% bands
  const buckets = new Map();
  for (const p of resolved) {
    if (p.confidence === null) continue;
    const band = Math.round(p.confidence * 10) / 10; // rounds to nearest 0.1
    if (!buckets.has(band)) buckets.set(band, { total: 0, correct: 0 });
    const b = buckets.get(band);
    b.total += 1;
    if (p.outcome.correct) b.correct += 1;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([band, data]) => ({
      predictedProb: band,
      actualRate: round4(data.correct / data.total),
      sampleSize: data.total,
      gap: round4(Math.abs(band - data.correct / data.total))
    }));
}

// ── Insight Generation ──────────────────────────────────────────────

function generateInsights(accuracy, predictions) {
  const insights = [];
  const resolved = predictions.filter((p) => p.resolved && p.outcome);

  if (resolved.length < 3) {
    insights.push("Not enough resolved predictions yet to generate meaningful insights. Keep running daily analyses.");
    return insights;
  }

  // Overall accuracy assessment
  if (accuracy.overall !== null) {
    if (accuracy.overall >= 0.7) {
      insights.push(`Overall accuracy is strong at ${(accuracy.overall * 100).toFixed(0)}%. Maintain current analytical approach.`);
    } else if (accuracy.overall >= 0.5) {
      insights.push(`Overall accuracy is moderate at ${(accuracy.overall * 100).toFixed(0)}%. Look for patterns in incorrect predictions to improve.`);
    } else {
      insights.push(`Overall accuracy is below 50% at ${(accuracy.overall * 100).toFixed(0)}%. Consider inverting or re-evaluating the analytical framework.`);
    }
  }

  // Action-specific insights
  for (const [action, stats] of Object.entries(accuracy.byAction)) {
    if (stats.total < 2) continue;
    if (action === "SCENARIO") continue;
    if (stats.accuracy < 0.4) {
      insights.push(`${action} recommendations have low accuracy (${(stats.accuracy * 100).toFixed(0)}% over ${stats.total} calls). Consider raising the conviction threshold before issuing ${action} calls.`);
    } else if (stats.accuracy >= 0.75) {
      insights.push(`${action} recommendations are highly reliable (${(stats.accuracy * 100).toFixed(0)}% over ${stats.total} calls). Lean into this strength.`);
    }
  }

  // Symbol-specific insights
  const symbolEntries = Object.entries(accuracy.bySymbol).filter(([s]) => s !== "__SCENARIO__");
  const poorSymbols = symbolEntries.filter(([, s]) => s.total >= 3 && s.accuracy < 0.4);
  const strongSymbols = symbolEntries.filter(([, s]) => s.total >= 3 && s.accuracy >= 0.75);

  if (poorSymbols.length > 0) {
    const names = poorSymbols.map(([s, st]) => `${s} (${(st.accuracy * 100).toFixed(0)}%)`).join(", ");
    insights.push(`Consistently poor accuracy on: ${names}. These symbols may need a different analytical lens or more conservative sizing.`);
  }
  if (strongSymbols.length > 0) {
    const names = strongSymbols.map(([s, st]) => `${s} (${(st.accuracy * 100).toFixed(0)}%)`).join(", ");
    insights.push(`Strong track record on: ${names}. Higher conviction warranted on these symbols.`);
  }

  // Calibration insights
  if (accuracy.calibration.length >= 2) {
    const avgGap = accuracy.calibration.reduce((sum, c) => sum + c.gap, 0) / accuracy.calibration.length;
    if (avgGap > 0.15) {
      insights.push(`Confidence calibration is off by ${(avgGap * 100).toFixed(0)}pp on average. Predicted probabilities don't match actual hit rates.`);
    }

    const overconfident = accuracy.calibration.filter((c) => c.predictedProb > c.actualRate + 0.1 && c.sampleSize >= 3);
    if (overconfident.length > 0) {
      insights.push("Tendency toward overconfidence detected. When stating high-confidence predictions, actual accuracy is lower than claimed.");
    }

    const underconfident = accuracy.calibration.filter((c) => c.actualRate > c.predictedProb + 0.1 && c.sampleSize >= 3);
    if (underconfident.length > 0) {
      insights.push("Tendency toward under-confidence detected. Some cautious predictions actually perform better than expected. Consider sizing up on these.");
    }
  }

  // Direction bias
  const upPredictions = resolved.filter((p) => p.expectedDirection === "up");
  const downPredictions = resolved.filter((p) => p.expectedDirection === "down");
  if (upPredictions.length > 0 && downPredictions.length > 0) {
    const upRate = upPredictions.filter((p) => p.outcome.correct).length / upPredictions.length;
    const downRate = downPredictions.filter((p) => p.outcome.correct).length / downPredictions.length;
    if (upRate < 0.4 && downRate >= 0.5) {
      insights.push("Bullish bias detected: bearish calls are more accurate than bullish ones. Apply extra skepticism to BUY recommendations.");
    }
    if (downRate < 0.4 && upRate >= 0.5) {
      insights.push("Bearish bias detected: bullish calls are more accurate than bearish ones. Apply extra skepticism to SELL/TRIM recommendations.");
    }
  }

  // Wallet-specific insights
  for (const [wallet, stats] of Object.entries(accuracy.byWallet)) {
    if (stats.total < 3) continue;
    if (stats.accuracy < 0.4) {
      insights.push(`Wallet "${wallet}" analysis underperforms (${(stats.accuracy * 100).toFixed(0)}% accuracy). Reevaluate the analytical approach for this market/asset class.`);
    }
  }

  return insights;
}

// ── Learning Recommendations ────────────────────────────────────────

function generateRecommendations(accuracy, insights) {
  const recs = [];

  if (accuracy.resolvedCount < 5) {
    recs.push({
      priority: "high",
      category: "data",
      recommendation: "Continue running daily AI analysis to build up a meaningful prediction history. At least 5-10 resolved predictions needed for reliable insights."
    });
    return recs;
  }

  // Adjust confidence thresholds
  if (accuracy.calibration.some((c) => c.gap > 0.2 && c.sampleSize >= 3)) {
    recs.push({
      priority: "high",
      category: "calibration",
      recommendation: "Adjust confidence levels in predictions. Large gap between stated confidence and actual accuracy detected. Use past accuracy rates as priors."
    });
  }

  // Action-specific adjustments
  for (const [action, stats] of Object.entries(accuracy.byAction)) {
    if (action === "SCENARIO" || stats.total < 3) continue;
    if (stats.accuracy < 0.4) {
      recs.push({
        priority: "high",
        category: "action_type",
        recommendation: `Reduce ${action} frequency or raise conviction threshold. Current accuracy: ${(stats.accuracy * 100).toFixed(0)}% over ${stats.total} calls.`
      });
    }
  }

  // Overall strategy adjustments
  if (accuracy.overall !== null && accuracy.overall < 0.5) {
    recs.push({
      priority: "critical",
      category: "strategy",
      recommendation: "Overall prediction accuracy below 50%. Consider: (1) narrowing prediction scope to highest-conviction calls only, (2) increasing use of HOLD over active BUY/SELL, (3) using wider stop levels."
    });
  }

  return recs;
}

// ── Ledger Management ───────────────────────────────────────────────

async function loadLedger(reportsDir) {
  const filePath = path.join(reportsDir, LEDGER_FILENAME);
  const existing = await loadJson(filePath);
  if (existing && existing.version) return existing;
  return {
    version: 1,
    lastUpdated: null,
    predictions: [],
    accuracy: null,
    insights: [],
    recommendations: [],
    dailyScores: []
  };
}

async function saveLedger(reportsDir, ledger) {
  const filePath = path.join(reportsDir, LEDGER_FILENAME);
  await fs.writeFile(filePath, JSON.stringify(ledger, null, 2), "utf8");
  return filePath;
}

// ── Main Entry Points ───────────────────────────────────────────────

/**
 * Update the AI learning ledger: extract new predictions, resolve past ones,
 * recompute accuracy and insights.
 *
 * @param {string} reportsDir - Path to the reports directory
 * @param {string} currentDate - Today's date (YYYY-MM-DD)
 * @returns {Object} Updated ledger
 */
export async function updateLearningLedger(reportsDir, currentDate) {
  const ledger = await loadLedger(reportsDir);
  const allFactualDates = await listReportDates(reportsDir);
  const allAiDates = await listAiDates(reportsDir);

  // 1. Extract new predictions from AI files not yet in ledger
  const existingPredictionDates = new Set(ledger.predictions.map((p) => p.date));

  for (const aiDate of allAiDates) {
    if (existingPredictionDates.has(aiDate)) continue;

    const aiData = await loadJson(path.join(reportsDir, `${aiDate}.ai.json`));
    if (!aiData) continue;

    const newPredictions = extractPredictions(aiData, aiDate);
    ledger.predictions.push(...newPredictions);
  }

  // 2. Resolve unresolved predictions where outcome data is available
  for (let i = 0; i < ledger.predictions.length; i++) {
    const pred = ledger.predictions[i];
    if (pred.resolved) continue;

    const days = horizonToDays(pred.horizon);
    const targetDate = (() => {
      const d = new Date(pred.date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    })();

    // Find the closest available report on or after target date
    const resolveDate = allFactualDates.find((d) => d >= targetDate) ?? null;
    if (!resolveDate) continue; // Not enough time has passed

    // Don't resolve with future dates beyond current
    if (resolveDate > currentDate) continue;

    const beforeReport = await loadJson(path.join(reportsDir, `${pred.date}.json`));
    const afterReport = await loadJson(path.join(reportsDir, `${resolveDate}.json`));
    if (!beforeReport || !afterReport) continue;

    const beforePositions = buildPositionMap(beforeReport);
    const afterPositions = buildPositionMap(afterReport);

    ledger.predictions[i] = resolvePrediction(pred, beforePositions, afterPositions, resolveDate);
  }

  // 3. Recompute accuracy metrics
  ledger.accuracy = computeAccuracy(ledger.predictions);

  // 4. Generate insights and recommendations
  ledger.insights = generateInsights(ledger.accuracy, ledger.predictions);
  ledger.recommendations = generateRecommendations(ledger.accuracy, ledger.insights);

  // 5. Compute daily accuracy score (for day-over-day tracking)
  const resolvedByDate = new Map();
  for (const p of ledger.predictions.filter((p) => p.resolved && p.outcome)) {
    const d = p.date;
    if (!resolvedByDate.has(d)) resolvedByDate.set(d, { total: 0, correct: 0 });
    const g = resolvedByDate.get(d);
    g.total += 1;
    if (p.outcome.correct) g.correct += 1;
  }

  ledger.dailyScores = [...resolvedByDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, data]) => ({
      date,
      total: data.total,
      correct: data.correct,
      accuracy: round4(data.correct / data.total)
    }));

  ledger.lastUpdated = currentDate;

  // 6. Save
  const ledgerPath = await saveLedger(reportsDir, ledger);

  return { ledger, ledgerPath };
}

/**
 * Generate a learning context string for the AI analysis pass.
 * This provides the AI with its own track record so it can self-correct.
 */
export function generateLearningContext(ledger) {
  if (!ledger || !ledger.accuracy || ledger.accuracy.resolvedCount === 0) {
    return "No prior AI predictions have been scored yet. This is the first analysis or no outcomes are available yet.";
  }

  const lines = [];
  lines.push("## AI Self-Learning Context (auto-generated from past accuracy)");
  lines.push("");

  // Overall performance
  const acc = ledger.accuracy;
  lines.push(`**Track Record:** ${acc.resolvedCount} predictions resolved out of ${acc.totalPredictions} total.`);
  if (acc.overall !== null) {
    lines.push(`**Overall Accuracy:** ${(acc.overall * 100).toFixed(1)}%`);
  }
  lines.push("");

  // Per-action accuracy
  if (Object.keys(acc.byAction).length > 0) {
    lines.push("**Accuracy by Action Type:**");
    for (const [action, stats] of Object.entries(acc.byAction)) {
      if (action === "SCENARIO") continue;
      lines.push(`- ${action}: ${(stats.accuracy * 100).toFixed(0)}% (${stats.correct}/${stats.total})`);
    }
    lines.push("");
  }

  // Per-wallet accuracy
  if (Object.keys(acc.byWallet).length > 0) {
    lines.push("**Accuracy by Wallet:**");
    for (const [wallet, stats] of Object.entries(acc.byWallet)) {
      lines.push(`- ${wallet}: ${(stats.accuracy * 100).toFixed(0)}% (${stats.correct}/${stats.total})`);
    }
    lines.push("");
  }

  // Key insights
  if (ledger.insights.length > 0) {
    lines.push("**Key Insights from Past Performance:**");
    for (const insight of ledger.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push("");
  }

  // Recommendations
  if (ledger.recommendations.length > 0) {
    lines.push("**Self-Improvement Directives:**");
    for (const rec of ledger.recommendations) {
      lines.push(`- [${rec.priority.toUpperCase()}] ${rec.recommendation}`);
    }
    lines.push("");
  }

  // Calibration warning
  if (acc.calibration.length > 0) {
    const avgGap = acc.calibration.reduce((s, c) => s + c.gap, 0) / acc.calibration.length;
    if (avgGap > 0.1) {
      lines.push("**CALIBRATION WARNING:** Stated confidence levels are off by " +
        `${(avgGap * 100).toFixed(0)}pp on average. Adjust probabilities to match historical hit rates.`);
      lines.push("");
    }
  }

  // Daily accuracy trend
  if (ledger.dailyScores.length >= 3) {
    const recent = ledger.dailyScores.slice(-5);
    lines.push("**Recent Daily Accuracy Trend:**");
    for (const s of recent) {
      const pct = (s.accuracy * 100).toFixed(0);
      const bar = "█".repeat(Math.round(s.accuracy * 10)) + "░".repeat(10 - Math.round(s.accuracy * 10));
      lines.push(`- ${s.date}: ${bar} ${pct}% (${s.correct}/${s.total})`);
    }
    lines.push("");
  }

  lines.push("Use this context to adjust confidence levels, action thresholds, and analytical focus. " +
    "Weight recommendations toward areas with proven accuracy and apply extra scrutiny to areas with poor track records.");

  return lines.join("\n");
}

/**
 * Get a summary of the learning status (for console output).
 */
export function learningStatusSummary(ledger) {
  if (!ledger?.accuracy) return "AI Learning: No data yet.";

  const acc = ledger.accuracy;
  const parts = [];
  parts.push(`Predictions: ${acc.totalPredictions}`);
  parts.push(`Resolved: ${acc.resolvedCount}`);
  if (acc.overall !== null) parts.push(`Accuracy: ${(acc.overall * 100).toFixed(0)}%`);
  parts.push(`Insights: ${ledger.insights.length}`);

  return `AI Learning: ${parts.join(" | ")}`;
}

export { extractPredictions as _extractPredictions };
export { normalizeAction as _normalizeAction };
export { parseProb as _parseProb };
export { computeAccuracy as _computeAccuracy };
export { resolvePrediction as _resolvePrediction };
export { horizonToDays as _horizonToDays };
