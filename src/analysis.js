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
  const withWeight = positions.map((p) => ({
    ...p,
    marketWeight: pct(nvl(p.marketValue), totalMarket)
  }));

  const overweight = withWeight
    .filter((p) => Number.isFinite(p.marketWeight) && p.marketWeight > risk.maxPositionWeight)
    .sort((a, b) => nvl(b.marketWeight) - nvl(a.marketWeight))
    .map((p) => ({
      symbol: p.symbol,
      marketWeight: round(p.marketWeight),
      marketValue: p.marketValue
    }));

  const top3Concentration = withWeight
    .sort((a, b) => nvl(b.marketWeight) - nvl(a.marketWeight))
    .slice(0, 3)
    .reduce((sum, p) => sum + nvl(p.marketWeight), 0);

  const bigLosers = withWeight
    .filter((p) => Number.isFinite(p.pnlPct) && p.pnlPct <= risk.drawdownWarnPct)
    .sort((a, b) => nvl(a.pnlPct) - nvl(b.pnlPct))
    .map((p) => ({
      symbol: p.symbol,
      pnlPct: p.pnlPct,
      pnl: p.pnl
    }));

  return {
    overweightPositions: overweight,
    top3Concentration: round(top3Concentration),
    top3ConcentrationBreached: top3Concentration > risk.top3ConcentrationWarn,
    bigLosers,
    weirdValues
  };
}

function makeActions(positions, snapshot, risk, watchlist) {
  const totalMarket = nvl(snapshot.totalMarketValue);
  const withWeight = positions.map((p) => ({
    ...p,
    marketWeight: pct(nvl(p.marketValue), totalMarket)
  }));

  const trimCandidates = withWeight
    .filter((p) => Number.isFinite(p.marketWeight) && p.marketWeight > risk.maxPositionWeight)
    .sort((a, b) => nvl(b.marketWeight) - nvl(a.marketWeight))
    .map((p) => ({
      symbol: p.symbol,
      marketWeight: round(p.marketWeight),
      options: [
        "Hold and accept concentration risk if thesis conviction is still high.",
        "Trim partially to reduce single-name concentration.",
        "Rebalance toward target weights over multiple sessions."
      ],
      tradeoff:
        "Trimming lowers downside concentration but may cap upside if momentum continues."
    }));

  const underweights = withWeight
    .filter((p) => Number.isFinite(p.marketWeight) && p.marketWeight < risk.minPositionWeight)
    .sort((a, b) => nvl(a.marketWeight) - nvl(b.marketWeight));

  const addCandidates = [];
  if (watchlist.length) {
    const held = new Set(withWeight.map((p) => normalizeSymbol(p.symbol)));
    for (const name of watchlist) {
      const symbol = normalizeSymbol(name);
      const existing = withWeight.find((item) => normalizeSymbol(item.symbol) === symbol);
      addCandidates.push({
        symbol,
        currentlyHeld: Boolean(existing || held.has(symbol)),
        currentWeight: round(existing?.marketWeight ?? null),
        options: [
          "Keep on watch if valuation or setup is not favorable yet.",
          "Build exposure gradually with predefined sizing limits.",
          "Skip and reallocate to stronger risk-adjusted opportunities."
        ],
        note: "This is a watchlist-based option set, not a buy recommendation."
      });
    }
  } else {
    addCandidates.push(
      ...underweights.map((p) => ({
        symbol: p.symbol,
        currentWeight: round(p.marketWeight),
        options: [
          "Keep weight small if uncertainty is still high.",
          "Scale only if thesis and liquidity checks remain valid.",
          "Leave unchanged to prioritize concentration control."
        ],
        note: "Underweight position shown for review, not a direct buy instruction."
      }))
    );
  }

  const stopLossReview = withWeight
    .filter((p) => Number.isFinite(p.pnlPct) && p.pnlPct <= risk.drawdownWarnPct)
    .sort((a, b) => nvl(a.pnlPct) - nvl(b.pnlPct))
    .map((p) => ({
      symbol: p.symbol,
      pnlPct: p.pnlPct,
      options: ["Hold with a clear invalidation level.", "Reduce risk exposure.", "Exit and rotate capital."],
      warning: "Avoid averaging down without a refreshed thesis and explicit risk limits."
    }));

  const takeProfitReview = withWeight
    .filter((p) => Number.isFinite(p.pnlPct) && p.pnlPct >= risk.takeProfitWarnPct)
    .sort((a, b) => nvl(b.pnlPct) - nvl(a.pnlPct))
    .map((p) => ({
      symbol: p.symbol,
      pnlPct: p.pnlPct,
      options: ["Hold and trail risk controls.", "Trim partially to lock gains.", "Rebalance to target allocations."]
    }));

  return {
    trimCandidates,
    addCandidates,
    stopLossReview,
    takeProfitReview
  };
}

function makeDeepInsights(activePositions, inactivePositions, snapshot, riskView) {
  const winners = activePositions.filter((p) => nvl(p.pnl) > 0);
  const losers = activePositions.filter((p) => nvl(p.pnl) < 0);
  const flat = activePositions.filter((p) => nvl(p.pnl) === 0);
  const hitRate = activePositions.length ? winners.length / activePositions.length : null;

  const topContributors = [...winners]
    .sort((a, b) => nvl(b.pnl) - nvl(a.pnl))
    .slice(0, 3)
    .map((p) => ({ symbol: p.symbol, pnl: p.pnl, pnlPct: p.pnlPct }));

  const topDetractors = [...losers]
    .sort((a, b) => nvl(a.pnl) - nvl(b.pnl))
    .slice(0, 3)
    .map((p) => ({ symbol: p.symbol, pnl: p.pnl, pnlPct: p.pnlPct }));

  const deadCapitalSpent = inactivePositions.reduce((sum, p) => {
    const market = nvl(p.marketValue);
    const spent = nvl(p.spent);
    if (market === 0 && spent > 0) return sum + spent;
    return sum;
  }, 0);

  const top3MarketShare = nvl(riskView.top3Concentration);
  const concentrationStress =
    top3MarketShare > 0.75 ? "high" : top3MarketShare > 0.55 ? "medium" : "controlled";

  const avgWinnerPct = winners.length
    ? winners.reduce((sum, p) => sum + nvl(p.pnlPct), 0) / winners.length
    : null;
  const avgLoserPct = losers.length
    ? losers.reduce((sum, p) => sum + nvl(p.pnlPct), 0) / losers.length
    : null;
  const multiLotSymbols = activePositions
    .filter((p) => nvl(p.sourceCount) > 1)
    .sort((a, b) => nvl(b.marketValue) - nvl(a.marketValue))
    .map((p) => ({
      symbol: p.symbol,
      rows: p.sourceCount,
      marketValue: p.marketValue,
      pnl: p.pnl
    }));

  return {
    concentrationStress,
    hitRate: round(hitRate),
    winnerCount: winners.length,
    loserCount: losers.length,
    flatCount: flat.length,
    topContributors,
    topDetractors,
    deadCapitalSpent: round(deadCapitalSpent),
    inactivePositionCount: inactivePositions.length,
    avgWinnerPct: round(avgWinnerPct),
    avgLoserPct: round(avgLoserPct),
    multiLotSymbols
  };
}

export function analyzePortfolio({ label, positions, weirdValues, risk, watchlist, adjustments = [] }) {
  const activePositions = positions.filter(isActivePosition);
  const inactivePositions = positions.filter((item) => !isActivePosition(item));

  const snapshot = makeSnapshot(activePositions, adjustments);
  const riskView = makeRisk(activePositions, snapshot, weirdValues, risk);
  const actions = makeActions(activePositions, snapshot, risk, watchlist);
  const deepInsights = makeDeepInsights(activePositions, inactivePositions, snapshot, riskView);

  return {
    label,
    rawPositionCount: positions.length,
    positionCount: activePositions.length,
    inactivePositionCount: inactivePositions.length,
    snapshot,
    risk: riskView,
    actions,
    deepInsights,
    checklist: [
      "Thesis still valid vs latest fundamentals?",
      "Any near-term earnings/news/events that change risk?",
      "Liquidity and slippage acceptable for current size?",
      "Any currency exposure drift vs base currency?",
      "Position sizes still aligned with risk budget?",
      "Rebalancing rules followed consistently?"
    ],
    adjustments,
    positions: activePositions,
    inactivePositions
  };
}
