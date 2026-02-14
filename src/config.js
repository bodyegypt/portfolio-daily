import fs from "node:fs/promises";

const DEFAULT_RISK = {
  maxPositionWeight: 0.2,
  top3ConcentrationWarn: 0.55,
  drawdownWarnPct: -0.15,
  takeProfitWarnPct: 0.25,
  minPositionWeight: 0.02
};

function toNumber(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) return fallback;
    if (value.endsWith("%")) {
      const parsed = Number.parseFloat(value.slice(0, -1));
      return Number.isFinite(parsed) ? parsed / 100 : fallback;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeWeight(raw, fallback) {
  const value = toNumber(raw, fallback);
  if (Math.abs(value) > 1) return value / 100;
  return value;
}

function normalizeDrawdown(raw, fallback) {
  const value = normalizeWeight(raw, fallback);
  return value > 0 ? -value : value;
}

export async function loadConfig(path) {
  const text = await fs.readFile(path, "utf8");
  const data = JSON.parse(text);

  const baseCurrency = String(data.baseCurrency ?? "USD").toUpperCase();
  const documents = Array.isArray(data.documents)
    ? data.documents
        .filter((item) => item && item.url)
        .map((item) => ({
          name: String(item.name ?? "Unnamed Document"),
          url: String(item.url),
          currency: String(item.currency ?? baseCurrency).toUpperCase()
        }))
    : [];

  if (documents.length === 0) {
    throw new Error("inputs.json must include at least one document URL in documents[].");
  }

  const riskRaw = data.risk ?? {};
  const risk = {
    maxPositionWeight: normalizeWeight(riskRaw.maxPositionWeight, DEFAULT_RISK.maxPositionWeight),
    top3ConcentrationWarn: normalizeWeight(
      riskRaw.top3ConcentrationWarn,
      DEFAULT_RISK.top3ConcentrationWarn
    ),
    drawdownWarnPct: normalizeDrawdown(riskRaw.drawdownWarnPct, DEFAULT_RISK.drawdownWarnPct),
    takeProfitWarnPct: normalizeWeight(riskRaw.takeProfitWarnPct, DEFAULT_RISK.takeProfitWarnPct),
    minPositionWeight: normalizeWeight(riskRaw.minPositionWeight, DEFAULT_RISK.minPositionWeight)
  };

  return {
    baseCurrency,
    googleApiKey: String(data.googleApiKey ?? process.env.GOOGLE_API_KEY ?? "").trim() || null,
    watchlist: Array.isArray(data.watchlist)
      ? data.watchlist.map((item) => String(item).trim()).filter(Boolean)
      : [],
    documents,
    risk
  };
}
