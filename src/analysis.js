function nvl(number) {
  return Number.isFinite(number) ? number : 0;
}

function pct(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total === 0) return null;
  return part / total;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function summarizeAdjustments(adjustments) {
  const list = Array.isArray(adjustments) ? adjustments : [];
  const spentDelta = list.reduce((sum, item) => sum + nvl(item.spentDelta), 0);
  const marketValueDelta = list.reduce((sum, item) => sum + nvl(item.marketValueDelta), 0);
  const pnlDelta = list.reduce((sum, item) => sum + nvl(item.pnlDelta), 0);
  const byKindMap = new Map();
  for (const item of list) {
    const key = String(item.kind ?? "other");
    byKindMap.set(key, (byKindMap.get(key) ?? 0) + nvl(item.amount));
  }
  const byKind = [...byKindMap.entries()].map(([kind, amount]) => ({ kind, amount: round(amount) }));
  return {
    count: list.length,
    spentDelta: round(spentDelta),
    marketValueDelta: round(marketValueDelta),
    pnlDelta: round(pnlDelta),
    byKind,
    entries: list
  };
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "").trim().toUpperCase();
}

function isActivePosition(position) {
  const qty = nvl(position.quantity);
  const market = nvl(position.marketValue);
  return Math.abs(qty) > 0 || market > 0;
}

export function aggregatePositions(positions) {
  const map = new Map();
  for (const pos of positions) {
    const key = normalizeSymbol(pos.symbol);
    if (!key) continue;
    const existing = map.get(key) ?? {
      symbol: key,
      quantity: 0,
      spent: 0,
      marketValue: 0,
      pnl: 0,
      pnlPctSum: 0,
      pnlPctCount: 0,
      sourceCount: 0
    };
    existing.quantity += nvl(pos.quantity);
    existing.spent += nvl(pos.spent);
    existing.marketValue += nvl(pos.marketValue);
    existing.pnl += nvl(pos.pnl);
    if (Number.isFinite(pos.pnlPct)) {
      existing.pnlPctSum += pos.pnlPct;
      existing.pnlPctCount += 1;
    }
    existing.sourceCount += 1;
    map.set(key, existing);
  }

  return [...map.values()].map((item) => {
    const avgCost = item.quantity ? item.spent / item.quantity : null;
    let pnlPct = null;
    if (item.spent > 0) {
      pnlPct = item.pnl / item.spent;
    } else if (item.pnlPctCount > 0) {
      pnlPct = item.pnlPctSum / item.pnlPctCount;
    }
    return {
      symbol: item.symbol,
      quantity: round(item.quantity),
      avgCost: round(avgCost),
      spent: round(item.spent),
      marketValue: round(item.marketValue),
      pnl: round(item.pnl),
      pnlPct: round(pnlPct),
      sourceCount: item.sourceCount
    };
  });
}

function makeSnapshot(positions, adjustments = []) {
  const adjustmentsSummary = summarizeAdjustments(adjustments);
  const baseSpent = positions.reduce((sum, p) => sum + nvl(p.spent), 0);
  const baseMarketValue = positions.reduce((sum, p) => sum + nvl(p.marketValue), 0);
  const basePnl = positions.reduce((sum, p) => sum + nvl(p.pnl), 0);

  const totalSpent = baseSpent + nvl(adjustmentsSummary.spentDelta);
  const totalMarketValue = baseMarketValue + nvl(adjustmentsSummary.marketValueDelta);
  const totalPnl = basePnl + nvl(adjustmentsSummary.pnlDelta);
  const totalPnlPct = pct(totalPnl, totalSpent);

  const weighted = positions
    .map((p) => ({
      ...p,
      marketWeight: pct(nvl(p.marketValue), totalMarketValue)
    }))
    .sort((a, b) => nvl(b.marketWeight) - nvl(a.marketWeight));

  return {
    baseSpent: round(baseSpent),
    baseMarketValue: round(baseMarketValue),
    basePnl: round(basePnl),
    totalSpent: round(totalSpent),
    totalMarketValue: round(totalMarketValue),
    totalPnl: round(totalPnl),
    totalPnlPct: round(totalPnlPct),
    adjustments: adjustmentsSummary,
    topPositions: weighted.slice(0, 5).map((p) => ({
      symbol: p.symbol,
      marketValue: p.marketValue,
      marketWeight: round(p.marketWeight)
    }))
  };
}

function makeRisk(positions, snapshot, weirdValues, risk) {
  const totalMarket = nvl(snapshot.totalMarketValue);
  const withWeight = positions.map((position) => ({
    ...position,
    marketWeight: pct(nvl(position.marketValue), totalMarket)
  }));

  const rankedByWeight = [...withWeight].sort((a, b) => nvl(b.marketWeight) - nvl(a.marketWeight));

  const overweight = rankedByWeight
    .filter((position) => Number.isFinite(position.marketWeight) && position.marketWeight > risk.maxPositionWeight)
    .map((position) => ({
      symbol: position.symbol,
      marketWeight: round(position.marketWeight),
      marketValue: position.marketValue
    }));

  const top3Concentration = rankedByWeight
    .slice(0, 3)
    .reduce((sum, position) => sum + nvl(position.marketWeight), 0);

  const bigLosers = withWeight
    .filter((position) => Number.isFinite(position.pnlPct) && position.pnlPct <= risk.drawdownWarnPct)
    .sort((a, b) => nvl(a.pnlPct) - nvl(b.pnlPct))
    .map((position) => ({
      symbol: position.symbol,
      pnlPct: position.pnlPct,
      pnl: position.pnl
    }));

  return {
    overweightPositions: overweight,
    top3Concentration: round(top3Concentration),
    top3ConcentrationBreached: top3Concentration > risk.top3ConcentrationWarn,
    bigLosers,
    weirdValues: Array.isArray(weirdValues) ? weirdValues : []
  };
}

export function analyzePortfolio({ label, positions, weirdValues, risk, adjustments = [] }) {
  const activePositions = positions.filter(isActivePosition);
  const inactivePositions = positions.filter((item) => !isActivePosition(item));

  const snapshot = makeSnapshot(activePositions, adjustments);
  const riskView = makeRisk(activePositions, snapshot, weirdValues, risk);

  return {
    label,
    rawPositionCount: positions.length,
    positionCount: activePositions.length,
    inactivePositionCount: inactivePositions.length,
    snapshot,
    risk: riskView,
    adjustments,
    positions: activePositions,
    inactivePositions
  };
}
