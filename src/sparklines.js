/**
 * Terminal Sparklines
 *
 * Renders inline mini-charts using Unicode block characters.
 * Shows P&L history per position over the last N days.
 *
 * Characters used: ▁▂▃▄▅▆▇█ (U+2581 to U+2588)
 * For negative-to-positive ranges, uses baseline positioning.
 */

const BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

function sparkline(values) {
  if (!values || values.length === 0) return "";
  if (values.length === 1) return BLOCKS[3];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) return BLOCKS[3].repeat(values.length);

  return values
    .map((v) => {
      const idx = Math.round(((v - min) / range) * (BLOCKS.length - 1));
      return BLOCKS[Math.max(0, Math.min(BLOCKS.length - 1, idx))];
    })
    .join("");
}

function trendArrow(values) {
  if (!values || values.length < 2) return " ";
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  if (last > prev) return "\u2191"; // ↑
  if (last < prev) return "\u2193"; // ↓
  return "\u2192"; // →
}

function pctColor(pct) {
  // Returns ANSI color codes for terminal
  if (!Number.isFinite(pct)) return "\x1b[0m";
  if (pct >= 0.1) return "\x1b[32;1m";  // bright green
  if (pct >= 0) return "\x1b[32m";       // green
  if (pct >= -0.1) return "\x1b[33m";    // yellow
  return "\x1b[31;1m";                   // bright red
}

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

export function renderSparklineTable(trends, currency = "USD") {
  if (!trends?.available || !trends.positions?.length) {
    return "  No historical data available for sparklines.\n";
  }

  const fmt = (v) => {
    if (!Number.isFinite(v)) return "    n/a";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(v);
  };

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return "  n/a";
    const s = (v * 100).toFixed(1);
    return v >= 0 ? `+${s}%` : `${s}%`;
  };

  const lines = [];
  lines.push("");
  lines.push(`${BOLD}  Symbol       P&L Trend (${trends.datesUsed.length}d)    Latest P&L   Momentum${RESET}`);
  lines.push(`${DIM}  ${"─".repeat(60)}${RESET}`);

  // Show top 15 positions by absolute momentum
  const top = trends.positions.slice(0, 15);

  for (const pos of top) {
    const spark = sparkline(pos.pnlHistory);
    const arrow = trendArrow(pos.pnlHistory);
    const color = pctColor(pos.latestPnlPct);
    const sym = pos.symbol.padEnd(10);
    const pnl = fmt(pos.latestPnl).padStart(12);
    const mom = fmtPct(pos.momentum).padStart(8);

    lines.push(`  ${sym} ${spark} ${arrow}  ${color}${pnl}${RESET}  ${mom}`);
  }

  if (trends.positions.length > 15) {
    lines.push(`${DIM}  ... and ${trends.positions.length - 15} more positions${RESET}`);
  }

  lines.push("");
  return lines.join("\n") + "\n";
}

export function renderPortfolioSparkline(trends) {
  if (!trends?.available || !trends.portfolio?.marketValueHistory?.length) {
    return "";
  }

  const mvSpark = sparkline(trends.portfolio.marketValueHistory);
  const pnlSpark = sparkline(trends.portfolio.pnlHistory);
  const arrow = trendArrow(trends.portfolio.marketValueHistory);
  const trendLabel = trends.portfolio.trend.replace("_", " ");

  const lines = [];
  lines.push(`${BOLD}  Portfolio Trend (${trends.datesUsed.length}d)${RESET}`);
  lines.push(`  Market Value: ${mvSpark} ${arrow}  (${trendLabel})`);
  lines.push(`  P&L:          ${pnlSpark}`);
  lines.push("");
  return lines.join("\n") + "\n";
}

// Plain text versions (no ANSI codes) for markdown output
export function sparklineToMarkdown(trends) {
  if (!trends?.available || !trends.positions?.length) {
    return "";
  }

  const lines = [];
  lines.push("## Position Trends");
  lines.push("");
  lines.push(`> ${trends.datesUsed.length}-day lookback: ${trends.datesUsed[0]} to ${trends.datesUsed[trends.datesUsed.length - 1]}`);
  lines.push("");
  lines.push("| Symbol | Sparkline | Trend | Momentum |");
  lines.push("|--------|-----------|-------|----------|");

  for (const pos of trends.positions.slice(0, 20)) {
    const spark = sparkline(pos.pnlHistory);
    const arrow = trendArrow(pos.pnlHistory);
    const mom = Number.isFinite(pos.momentum) ? `${(pos.momentum * 100).toFixed(1)}%` : "n/a";
    lines.push(`| ${pos.symbol} | ${spark} ${arrow} | ${pos.trend} | ${mom} |`);
  }

  lines.push("");
  return lines.join("\n") + "\n";
}

// Re-export the raw sparkline function for use in other modules
export { sparkline, trendArrow };
