import fs from "node:fs/promises";
import path from "node:path";

/**
 * Self-Contained HTML Report
 *
 * Generates a single HTML file with:
 * - Embedded CSS (no external dependencies)
 * - Portfolio treemap visualization (pure CSS/JS, no libraries)
 * - Color-coded P&L heatmap
 * - Health score gauge
 * - Responsive layout
 */

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

function pnlColor(pnlPct) {
  if (!Number.isFinite(pnlPct)) return "#888";
  if (pnlPct >= 0.2) return "#00c853";
  if (pnlPct >= 0.1) return "#4caf50";
  if (pnlPct >= 0.05) return "#8bc34a";
  if (pnlPct >= 0) return "#c8e6c9";
  if (pnlPct >= -0.05) return "#ffe0b2";
  if (pnlPct >= -0.1) return "#ff9800";
  if (pnlPct >= -0.2) return "#f44336";
  return "#b71c1c";
}

function pnlTextColor(pnlPct) {
  if (!Number.isFinite(pnlPct)) return "#fff";
  if (pnlPct >= 0.05 && pnlPct < 0.1) return "#1b5e20";
  if (pnlPct >= 0 && pnlPct < 0.05) return "#1b5e20";
  if (pnlPct >= -0.05 && pnlPct < 0) return "#333";
  return "#fff";
}

function healthGaugeColor(score) {
  if (score >= 80) return "#00c853";
  if (score >= 60) return "#4caf50";
  if (score >= 40) return "#ff9800";
  if (score >= 20) return "#f44336";
  return "#b71c1c";
}

function safeJsonForHtml(obj) {
  // Prevent </script> injection and other HTML-breaking sequences in inline JSON
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function buildTreemapData(positions, totalMV) {
  if (!positions?.length || totalMV <= 0) return "[]";
  const items = positions
    .filter((p) => (p.marketValue ?? 0) > 0)
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .slice(0, 30)
    .map((p) => ({
      symbol: p.symbol,
      value: p.marketValue ?? 0,
      weight: totalMV > 0 ? ((p.marketValue ?? 0) / totalMV) * 100 : 0,
      pnlPct: p.pnlPct ?? 0,
      color: pnlColor(p.pnlPct),
      textColor: pnlTextColor(p.pnlPct)
    }));
  return safeJsonForHtml(items);
}

function buildPositionTableRows(positions, currency, totalMV) {
  if (!positions?.length) return "<tr><td colspan='7'>No positions</td></tr>";
  return positions
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0))
    .map((p) => {
      const weight = totalMV > 0 ? (p.marketValue ?? 0) / totalMV : 0;
      const color = pnlColor(p.pnlPct);
      return `<tr>
        <td class="sym">${escapeHtml(p.symbol)}</td>
        <td class="num">${fmtCurrency(p.marketValue, currency)}</td>
        <td class="num">${fmtPct(weight)}</td>
        <td class="num">${fmtCurrency(p.spent, currency)}</td>
        <td class="num" style="color:${color};font-weight:600">${fmtCurrency(p.pnl, currency)}</td>
        <td class="num" style="color:${color};font-weight:600">${fmtPct(p.pnlPct)}</td>
        <td><div class="pnl-bar" style="background:${color};width:${Math.min(Math.abs((p.pnlPct ?? 0) * 200), 100)}%">&nbsp;</div></td>
      </tr>`;
    })
    .join("\n");
}

function buildWalletCards(worksheets, currency) {
  if (!worksheets?.length) return "";
  return worksheets
    .map((ws) => {
      const a = ws.analysis;
      const snap = a?.snapshot ?? {};
      return `<div class="wallet-card">
        <h3>${escapeHtml(ws.walletName)}</h3>
        <div class="wallet-meta">${escapeHtml(ws.market)} | ${escapeHtml(ws.currency)} | ${a?.positionCount ?? 0} positions</div>
        <div class="wallet-stats">
          <div class="stat">
            <span class="stat-label">Market Value</span>
            <span class="stat-value">${fmtCurrency(snap.totalMarketValue, ws.currency)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">P&L</span>
            <span class="stat-value" style="color:${pnlColor(snap.totalPnlPct)}">${fmtCurrency(snap.totalPnl, ws.currency)} (${fmtPct(snap.totalPnlPct)})</span>
          </div>
          <div class="stat">
            <span class="stat-label">Top 3 Concentration</span>
            <span class="stat-value">${fmtPct(a?.risk?.top3Concentration)}</span>
          </div>
        </div>
      </div>`;
    })
    .join("\n");
}

export function toHtml(dailyReport, healthScore = null, diff = null, trends = null) {
  const combined = dailyReport.combined;
  const currency = dailyReport.combinedCurrency || dailyReport.baseCurrency;
  const snap = combined?.snapshot ?? {};
  const totalMV = snap.totalMarketValue ?? 0;
  const positions = combined?.positions ?? [];

  const treemapData = buildTreemapData(positions, totalMV);
  const positionRows = buildPositionTableRows(positions, currency, totalMV);
  const walletCards = buildWalletCards(dailyReport.worksheets, currency);

  // Health score section
  const healthHtml = healthScore
    ? `<div class="health-gauge">
        <div class="gauge-circle" style="--score:${healthScore.score};--color:${healthGaugeColor(healthScore.score)}">
          <span class="gauge-value">${healthScore.score}</span>
        </div>
        <div class="gauge-label">${escapeHtml(healthScore.label)}</div>
        <div class="gauge-dims">
          <div class="dim"><span>Diversification</span><span>${healthScore.dimensions.diversification}/25</span></div>
          <div class="dim"><span>Risk Exposure</span><span>${healthScore.dimensions.riskExposure}/25</span></div>
          <div class="dim"><span>Performance</span><span>${healthScore.dimensions.performance}/25</span></div>
          <div class="dim"><span>Data Quality</span><span>${healthScore.dimensions.dataQuality}/25</span></div>
        </div>
      </div>`
    : "";

  // Diff section
  let diffHtml = "";
  if (diff?.available) {
    const pd = diff.portfolioDelta;
    const sign = (v) => (v > 0 ? "+" : "");
    diffHtml = `<div class="diff-section">
      <h2>Day-over-Day Changes</h2>
      <div class="diff-meta">${escapeHtml(diff.previousDate)} &rarr; ${escapeHtml(diff.currentDate)}</div>
      <div class="diff-grid">
        <div class="diff-stat">
          <span class="diff-label">MV Delta</span>
          <span class="diff-value" style="color:${pd.marketValueDelta >= 0 ? "#4caf50" : "#f44336"}">${sign(pd.marketValueDelta)}${fmtCurrency(pd.marketValueDelta, currency)}</span>
        </div>
        <div class="diff-stat">
          <span class="diff-label">P&L Delta</span>
          <span class="diff-value" style="color:${pd.pnlDelta >= 0 ? "#4caf50" : "#f44336"}">${sign(pd.pnlDelta)}${fmtCurrency(pd.pnlDelta, currency)}</span>
        </div>
        <div class="diff-stat">
          <span class="diff-label">Positions</span>
          <span class="diff-value">${pd.positionCountBefore} &rarr; ${pd.positionCountAfter}</span>
        </div>
      </div>
      ${diff.newPositions.length ? `<div class="diff-list"><strong>New:</strong> ${diff.newPositions.map((p) => escapeHtml(p.symbol)).join(", ")}</div>` : ""}
      ${diff.closedPositions.length ? `<div class="diff-list"><strong>Closed:</strong> ${diff.closedPositions.map((p) => escapeHtml(p.symbol)).join(", ")}</div>` : ""}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Portfolio Report - ${escapeHtml(dailyReport.date)}</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.5; padding: 24px; }
  .container { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 1.8em; margin-bottom: 4px; }
  h2 { font-size: 1.3em; margin: 24px 0 12px; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  h3 { font-size: 1.1em; margin-bottom: 8px; }
  .subtitle { color: var(--text-dim); margin-bottom: 24px; }
  .top-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .metric-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .metric-label { font-size: 0.8em; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .metric-value { font-size: 1.6em; font-weight: 700; margin-top: 4px; }

  /* Health Gauge */
  .health-gauge { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 24px; text-align: center; margin-bottom: 24px; }
  .gauge-circle { width: 120px; height: 120px; border-radius: 50%; margin: 0 auto 12px;
    background: conic-gradient(var(--color) calc(var(--score) * 1%), var(--border) 0);
    display: flex; align-items: center; justify-content: center; position: relative; }
  .gauge-circle::before { content: ''; width: 90px; height: 90px; border-radius: 50%; background: var(--surface); position: absolute; }
  .gauge-value { position: relative; z-index: 1; font-size: 2em; font-weight: 800; }
  .gauge-label { font-size: 1.2em; font-weight: 600; margin-bottom: 16px; }
  .gauge-dims { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
  .dim { display: flex; flex-direction: column; font-size: 0.85em; }
  .dim span:first-child { color: var(--text-dim); }

  /* Treemap */
  .treemap-container { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .treemap { display: flex; flex-wrap: wrap; gap: 2px; min-height: 200px; }
  .treemap-cell { display: flex; align-items: center; justify-content: center; flex-direction: column;
    border-radius: 4px; padding: 4px; min-width: 40px; overflow: hidden; cursor: default; transition: opacity 0.2s; }
  .treemap-cell:hover { opacity: 0.85; }
  .treemap-cell .sym { font-weight: 700; font-size: 0.8em; white-space: nowrap; }
  .treemap-cell .val { font-size: 0.65em; opacity: 0.9; }

  /* Position Table */
  .pos-table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
  .pos-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid var(--border);
    color: var(--text-dim); font-weight: 600; font-size: 0.85em; text-transform: uppercase; }
  .pos-table td { padding: 6px 12px; border-bottom: 1px solid var(--border); }
  .pos-table tr:hover td { background: rgba(88,166,255,0.05); }
  .pos-table .sym { font-weight: 600; }
  .pos-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .pnl-bar { height: 6px; border-radius: 3px; min-width: 2px; }

  /* Wallet Cards */
  .wallet-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .wallet-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .wallet-meta { font-size: 0.85em; color: var(--text-dim); margin-bottom: 12px; }
  .wallet-stats { display: flex; flex-direction: column; gap: 8px; }
  .stat { display: flex; justify-content: space-between; }
  .stat-label { color: var(--text-dim); font-size: 0.9em; }
  .stat-value { font-weight: 600; }

  /* Diff Section */
  .diff-section { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .diff-meta { color: var(--text-dim); font-size: 0.9em; margin-bottom: 12px; }
  .diff-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .diff-stat { display: flex; flex-direction: column; }
  .diff-label { font-size: 0.8em; color: var(--text-dim); }
  .diff-value { font-size: 1.2em; font-weight: 600; }
  .diff-list { font-size: 0.9em; margin-top: 8px; }

  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border);
    color: var(--text-dim); font-size: 0.8em; text-align: center; }

  @media (max-width: 600px) {
    body { padding: 12px; }
    .top-grid { grid-template-columns: 1fr 1fr; }
    .gauge-dims { flex-direction: column; align-items: center; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>Portfolio Report</h1>
  <div class="subtitle">${escapeHtml(dailyReport.date)} &middot; ${escapeHtml(currency)} &middot; ${combined?.positionCount ?? 0} positions</div>

  <div class="top-grid">
    <div class="metric-card">
      <div class="metric-label">Market Value</div>
      <div class="metric-value">${fmtCurrency(snap.totalMarketValue, currency)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total Invested</div>
      <div class="metric-value">${fmtCurrency(snap.totalSpent, currency)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Total P&amp;L</div>
      <div class="metric-value" style="color:${pnlColor(snap.totalPnlPct)}">${fmtCurrency(snap.totalPnl, currency)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Return</div>
      <div class="metric-value" style="color:${pnlColor(snap.totalPnlPct)}">${fmtPct(snap.totalPnlPct)}</div>
    </div>
  </div>

  ${healthHtml}
  ${diffHtml}

  <h2>Position Treemap</h2>
  <div class="treemap-container">
    <div class="treemap" id="treemap"></div>
  </div>

  <h2>All Positions</h2>
  <div style="overflow-x:auto">
    <table class="pos-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th class="num">Market Value</th>
          <th class="num">Weight</th>
          <th class="num">Invested</th>
          <th class="num">P&amp;L</th>
          <th class="num">Return</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${positionRows}
      </tbody>
    </table>
  </div>

  <h2>Wallets</h2>
  <div class="wallet-grid">
    ${walletCards}
  </div>

  <div class="footer">
    Generated by portfolio-daily &middot; ${escapeHtml(dailyReport.date)}
  </div>
</div>
<script>
(function() {
  const data = ${treemapData};
  const container = document.getElementById('treemap');
  if (!data.length) { container.textContent = 'No position data'; return; }
  const totalWeight = data.reduce(function(s,d){ return s + d.weight; }, 0);
  data.forEach(function(d) {
    var cell = document.createElement('div');
    cell.className = 'treemap-cell';
    var pct = (d.weight / totalWeight) * 100;
    cell.style.flexBasis = Math.max(pct, 3) + '%';
    cell.style.flexGrow = pct;
    cell.style.background = d.color;
    cell.style.color = d.textColor;
    cell.style.height = Math.max(50, Math.min(150, pct * 3)) + 'px';
    cell.title = d.symbol + ': ' + d.weight.toFixed(1) + '% of portfolio, P&L ' + (d.pnlPct * 100).toFixed(1) + '%';
    cell.innerHTML = '<span class="sym">' + d.symbol + '</span><span class="val">' + d.weight.toFixed(1) + '%</span>';
    container.appendChild(cell);
  });
})();
</script>
</body>
</html>`;
}

export async function writeHtmlReport(dailyReport, outputDir, healthScore = null, diff = null, trends = null) {
  const htmlPath = path.join(outputDir, `${dailyReport.date}.html`);
  const html = toHtml(dailyReport, healthScore, diff, trends);
  await fs.writeFile(htmlPath, html, "utf8");
  return htmlPath;
}
