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

function ensureInRange(name, value, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}. Received: ${value}`);
  }
}

function normalizeDocument(item, index, baseCurrency) {
  const row = index + 1;
  const name = String(item.name ?? `Document ${row}`).trim() || `Document ${row}`;
  const url = String(item.url ?? "").trim();
  const currency = String(item.currency ?? baseCurrency).trim().toUpperCase();

  if (!url) {
    throw new Error(`documents[${index}].url is required.`);
  }
  if (!/^https:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(url)) {
    throw new Error(
      `documents[${index}].url must be a Google Sheets document URL. Received: ${url}`
    );
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`documents[${index}].currency must be a 3-letter code. Received: ${currency}`);
  }

  return { name, url, currency };
}

export async function loadConfig(path) {
  const text = await fs.readFile(path, "utf8");
  const data = JSON.parse(text);

  const baseCurrency = String(data.baseCurrency ?? "USD").toUpperCase();
  const documents = Array.isArray(data.documents)
    ? data.documents
        .filter(Boolean)
        .map((item, index) => normalizeDocument(item, index, baseCurrency))
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
  ensureInRange("risk.maxPositionWeight", risk.maxPositionWeight, 0, 1);
  ensureInRange("risk.top3ConcentrationWarn", risk.top3ConcentrationWarn, 0, 1);
  ensureInRange("risk.minPositionWeight", risk.minPositionWeight, 0, 1);
  ensureInRange("risk.takeProfitWarnPct", risk.takeProfitWarnPct, -1, 10);
  ensureInRange("risk.drawdownWarnPct", risk.drawdownWarnPct, -1, 0);

  const inlineApiKey = String(data.googleApiKey ?? "").trim();
  const envApiKey = String(process.env.GOOGLE_API_KEY ?? "").trim();
  return {
    baseCurrency,
    googleApiKey: envApiKey || inlineApiKey || null,
    watchlist: Array.isArray(data.watchlist)
      ? data.watchlist.map((item) => String(item).trim()).filter(Boolean)
      : [],
    documents,
    risk
  };
}
