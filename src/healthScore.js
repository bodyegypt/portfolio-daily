/**
 * Portfolio Health Score
 *
 * Distills the entire portfolio state into a single 0-100 composite score
 * across four dimensions:
 *
 *   1. Diversification (25pts) - How well-spread are position weights?
 *   2. Risk Exposure   (25pts) - Overweight positions, concentration breaches
 *   3. Performance     (25pts) - Overall P&L and drawdown severity
 *   4. Data Quality    (25pts) - Missing/weird values, parse failures
 *
 * Each dimension scores 0-25. The sum gives the final health score.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreDiversification(analysis, risk) {
  if (!analysis?.positions?.length) return 0;

  const positions = analysis.positions;
  const totalMV = analysis.snapshot?.totalMarketValue ?? 0;
  if (totalMV <= 0) return 0;

  const weights = positions.map((p) => (p.marketValue ?? 0) / totalMV);

  // Herfindahl-Hirschman Index (HHI) - lower is more diversified
  const hhi = weights.reduce((sum, w) => sum + w * w, 0);
  // Perfect diversification for N positions: HHI = 1/N
  const n = positions.length;
  const perfectHHI = n > 0 ? 1 / n : 1;
  // Worst case: HHI = 1 (single position)
  // Score: how close to perfect vs worst
  const hhiScore = n > 1 ? clamp((1 - hhi) / (1 - perfectHHI), 0, 1) : 0;

  // Position count bonus (more positions = better diversification, up to a point)
  const countScore = clamp(n / 15, 0, 1);

  // Underweight penalty - positions below minimum weight threshold
  const underweight = weights.filter((w) => w < risk.minPositionWeight).length;
  const underweightPenalty = clamp(underweight / n, 0, 0.5);

  const raw = (hhiScore * 0.5 + countScore * 0.3 + (1 - underweightPenalty) * 0.2) * 25;
  return Math.round(clamp(raw, 0, 25));
}

function scoreRiskExposure(analysis, risk) {
  let score = 25;

  // Overweight positions: -3 each
  const overweight = analysis.risk?.overweightPositions?.length ?? 0;
  score -= overweight * 3;

  // Top 3 concentration breach: -8
  if (analysis.risk?.top3ConcentrationBreached) score -= 8;

  // Top 3 concentration close to threshold (>80% of threshold): -3
  const top3 = analysis.risk?.top3Concentration ?? 0;
  if (!analysis.risk?.top3ConcentrationBreached && top3 > risk.top3ConcentrationWarn * 0.8) {
    score -= 3;
  }

  // Big losers: -2 each
  const bigLosers = analysis.risk?.bigLosers?.length ?? 0;
  score -= bigLosers * 2;

  return Math.round(clamp(score, 0, 25));
}

function scorePerformance(analysis) {
  const pnlPct = analysis.snapshot?.totalPnlPct ?? 0;

  let score;
  if (pnlPct >= 0.15) {
    score = 25; // Strong positive
  } else if (pnlPct >= 0.05) {
    score = 20 + (pnlPct - 0.05) * 50; // 20-25 range
  } else if (pnlPct >= 0) {
    score = 15 + pnlPct * 100; // 15-20 range
  } else if (pnlPct >= -0.05) {
    score = 10 + (pnlPct + 0.05) * 100; // 10-15 range
  } else if (pnlPct >= -0.15) {
    score = 5 + (pnlPct + 0.15) * 50; // 5-10 range
  } else {
    score = Math.max(0, 5 + (pnlPct + 0.15) * 20); // 0-5 range
  }

  return Math.round(clamp(score, 0, 25));
}

function scoreDataQuality(analysis, failures = []) {
  let score = 25;

  // Weird values: -1 each, capped
  const weirdCount = analysis.risk?.weirdValues?.length ?? 0;
  score -= Math.min(weirdCount * 1, 10);

  // Failures: -5 each
  score -= failures.length * 5;

  // No positions parsed at all: -15
  if ((analysis.positionCount ?? 0) === 0) score -= 15;

  return Math.round(clamp(score, 0, 25));
}

function healthLabel(score) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 60) return "Fair";
  if (score >= 40) return "Needs Attention";
  if (score >= 20) return "Poor";
  return "Critical";
}

function healthBar(score) {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
  return `[${bar}] ${score}/100`;
}

export function computeHealthScore(dailyReport) {
  const analysis = dailyReport.combined;
  if (!analysis) {
    return {
      score: 0,
      label: "No Data",
      bar: healthBar(0),
      dimensions: { diversification: 0, riskExposure: 0, performance: 0, dataQuality: 0 }
    };
  }

  const risk = dailyReport.configUsed?.risk ?? {
    maxPositionWeight: 0.2,
    top3ConcentrationWarn: 0.55,
    drawdownWarnPct: -0.15,
    takeProfitWarnPct: 0.25,
    minPositionWeight: 0.02
  };

  const diversification = scoreDiversification(analysis, risk);
  const riskExposure = scoreRiskExposure(analysis, risk);
  const performance = scorePerformance(analysis);
  const dataQuality = scoreDataQuality(analysis, dailyReport.failures ?? []);

  const score = diversification + riskExposure + performance + dataQuality;

  return {
    score,
    label: healthLabel(score),
    bar: healthBar(score),
    dimensions: {
      diversification,
      riskExposure,
      performance,
      dataQuality
    }
  };
}

export function healthScoreToMarkdown(health) {
  const lines = [];
  lines.push("## Portfolio Health Score");
  lines.push("");
  lines.push(`**${health.score}/100** - ${health.label}`);
  lines.push("");
  lines.push("```");
  lines.push(health.bar);
  lines.push("```");
  lines.push("");
  lines.push("| Dimension | Score | Max |");
  lines.push("|---|---|---|");
  lines.push(`| Diversification | ${health.dimensions.diversification} | 25 |`);
  lines.push(`| Risk Exposure | ${health.dimensions.riskExposure} | 25 |`);
  lines.push(`| Performance | ${health.dimensions.performance} | 25 |`);
  lines.push(`| Data Quality | ${health.dimensions.dataQuality} | 25 |`);
  lines.push("");
  return lines.join("\n") + "\n";
}
