import fs from "node:fs/promises";
import path from "node:path";

/**
 * AI Scorecard Generator
 *
 * Produces human-readable (Markdown) and machine-readable (JSON) scorecards
 * summarizing AI prediction accuracy, calibration, and self-improvement directives.
 */

function fmtPct(v) {
  if (!Number.isFinite(v)) return "n/a";
  return `${(v * 100).toFixed(1)}%`;
}

function accuracyBar(accuracy, width = 20) {
  if (!Number.isFinite(accuracy)) return "░".repeat(width);
  const filled = Math.round(accuracy * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function gradeAccuracy(accuracy) {
  if (!Number.isFinite(accuracy)) return { grade: "?", label: "No Data" };
  if (accuracy >= 0.8) return { grade: "A", label: "Excellent" };
  if (accuracy >= 0.65) return { grade: "B", label: "Good" };
  if (accuracy >= 0.5) return { grade: "C", label: "Fair" };
  if (accuracy >= 0.35) return { grade: "D", label: "Poor" };
  return { grade: "F", label: "Failing" };
}

/**
 * Generate a Markdown scorecard from the learning ledger.
 */
export function scorecardToMarkdown(ledger, currentDate) {
  const lines = [];
  const acc = ledger.accuracy;

  lines.push(`# AI Prediction Scorecard — ${currentDate}`);
  lines.push("");

  if (!acc || acc.resolvedCount === 0) {
    lines.push("> No predictions have been resolved yet. Run the AI analysis pass daily");
    lines.push("> and outcomes will be scored automatically as factual reports become available.");
    return lines.join("\n") + "\n";
  }

  // ── Summary Box ──
  const { grade, label } = gradeAccuracy(acc.overall);
  lines.push("## Overall Performance");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Grade | **${grade}** (${label}) |`);
  lines.push(`| Overall Accuracy | ${fmtPct(acc.overall)} |`);
  lines.push(`| Total Predictions | ${acc.totalPredictions} |`);
  lines.push(`| Resolved | ${acc.resolvedCount} |`);
  lines.push(`| Pending | ${acc.unresolvedCount} |`);
  lines.push(`| Correct | ${acc.resolvedCount > 0 ? ledger.predictions.filter((p) => p.outcome?.correct).length : 0} |`);
  lines.push("");

  // ── Accuracy by Action ──
  if (Object.keys(acc.byAction).length > 0) {
    lines.push("## Accuracy by Action Type");
    lines.push("");
    lines.push("| Action | Accuracy | Correct | Total | Bar |");
    lines.push("|--------|----------|---------|-------|-----|");
    for (const [action, stats] of Object.entries(acc.byAction)) {
      lines.push(
        `| ${action} | ${fmtPct(stats.accuracy)} | ${stats.correct} | ${stats.total} | ${accuracyBar(stats.accuracy, 10)} |`
      );
    }
    lines.push("");
  }

  // ── Accuracy by Wallet ──
  if (Object.keys(acc.byWallet).length > 0) {
    lines.push("## Accuracy by Wallet");
    lines.push("");
    lines.push("| Wallet | Accuracy | Correct | Total |");
    lines.push("|--------|----------|---------|-------|");
    for (const [wallet, stats] of Object.entries(acc.byWallet)) {
      lines.push(`| ${wallet} | ${fmtPct(stats.accuracy)} | ${stats.correct} | ${stats.total} |`);
    }
    lines.push("");
  }

  // ── Accuracy by Horizon ──
  if (Object.keys(acc.byHorizon).length > 0) {
    lines.push("## Accuracy by Time Horizon");
    lines.push("");
    lines.push("| Horizon | Accuracy | Correct | Total |");
    lines.push("|---------|----------|---------|-------|");
    for (const [horizon, stats] of Object.entries(acc.byHorizon)) {
      lines.push(`| ${horizon} | ${fmtPct(stats.accuracy)} | ${stats.correct} | ${stats.total} |`);
    }
    lines.push("");
  }

  // ── Per-Symbol Breakdown ──
  const symbolEntries = Object.entries(acc.bySymbol)
    .filter(([s]) => s !== "__SCENARIO__")
    .sort((a, b) => b[1].total - a[1].total);

  if (symbolEntries.length > 0) {
    lines.push("## Per-Symbol Accuracy (sorted by frequency)");
    lines.push("");
    lines.push("| Symbol | Accuracy | Correct | Total | Grade |");
    lines.push("|--------|----------|---------|-------|-------|");
    for (const [symbol, stats] of symbolEntries.slice(0, 20)) {
      const g = gradeAccuracy(stats.accuracy);
      lines.push(`| ${symbol} | ${fmtPct(stats.accuracy)} | ${stats.correct} | ${stats.total} | ${g.grade} |`);
    }
    lines.push("");
  }

  // ── Calibration Chart ──
  if (acc.calibration.length > 0) {
    lines.push("## Confidence Calibration");
    lines.push("");
    lines.push("| Predicted | Actual | Gap | Samples | Status |");
    lines.push("|-----------|--------|-----|---------|--------|");
    for (const c of acc.calibration) {
      const status = c.gap <= 0.1 ? "Well-calibrated" : c.predictedProb > c.actualRate ? "Overconfident" : "Under-confident";
      lines.push(
        `| ${fmtPct(c.predictedProb)} | ${fmtPct(c.actualRate)} | ${fmtPct(c.gap)} | ${c.sampleSize} | ${status} |`
      );
    }
    lines.push("");
  }

  // ── Daily Trend ──
  if (ledger.dailyScores.length > 0) {
    lines.push("## Daily Accuracy Trend");
    lines.push("");
    lines.push("| Date | Accuracy | Correct | Total | Trend |");
    lines.push("|------|----------|---------|-------|-------|");
    for (const s of ledger.dailyScores.slice(-14)) {
      lines.push(
        `| ${s.date} | ${fmtPct(s.accuracy)} | ${s.correct} | ${s.total} | ${accuracyBar(s.accuracy, 10)} |`
      );
    }
    lines.push("");
  }

  // ── Insights ──
  if (ledger.insights.length > 0) {
    lines.push("## Insights");
    lines.push("");
    for (const insight of ledger.insights) {
      lines.push(`- ${insight}`);
    }
    lines.push("");
  }

  // ── Recommendations ──
  if (ledger.recommendations.length > 0) {
    lines.push("## Self-Improvement Recommendations");
    lines.push("");
    for (const rec of ledger.recommendations) {
      const icon = rec.priority === "critical" ? "🔴" : rec.priority === "high" ? "🟡" : "🟢";
      lines.push(`- **[${rec.priority.toUpperCase()}]** (${rec.category}) ${rec.recommendation}`);
    }
    lines.push("");
  }

  // ── Recent Predictions Detail ──
  const recentResolved = ledger.predictions
    .filter((p) => p.resolved && p.outcome && p.action !== "SCENARIO")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 15);

  if (recentResolved.length > 0) {
    lines.push("## Recent Prediction Outcomes (last 15)");
    lines.push("");
    lines.push("| Date | Symbol | Action | Expected | Actual | P&L Change | Result |");
    lines.push("|------|--------|--------|----------|--------|------------|--------|");
    for (const p of recentResolved) {
      const result = p.outcome.correct ? "Correct" : "Wrong";
      const pnlChange = p.outcome.pnlPctChange !== null ? fmtPct(p.outcome.pnlPctChange) : "n/a";
      lines.push(
        `| ${p.date} | ${p.symbol} | ${p.action} | ${p.expectedDirection ?? "?"} | ${p.outcome.actualDirection} | ${pnlChange} | ${result} |`
      );
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

/**
 * Generate a JSON scorecard (machine-readable subset of the ledger).
 */
export function scorecardToJson(ledger, currentDate) {
  return {
    date: currentDate,
    accuracy: ledger.accuracy,
    insights: ledger.insights,
    recommendations: ledger.recommendations,
    dailyScores: ledger.dailyScores,
    predictionCount: ledger.predictions.length,
    resolvedCount: ledger.accuracy?.resolvedCount ?? 0
  };
}

/**
 * Write scorecard files to disk.
 */
export async function writeScorecard(ledger, reportsDir, currentDate) {
  await fs.mkdir(reportsDir, { recursive: true });

  const mdPath = path.join(reportsDir, `${currentDate}.ai-scorecard.md`);
  const jsonPath = path.join(reportsDir, `${currentDate}.ai-scorecard.json`);

  const md = scorecardToMarkdown(ledger, currentDate);
  const json = scorecardToJson(ledger, currentDate);

  await Promise.all([
    fs.writeFile(mdPath, md, "utf8"),
    fs.writeFile(jsonPath, JSON.stringify(json, null, 2), "utf8")
  ]);

  return { mdPath, jsonPath };
}
