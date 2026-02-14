function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function classifyMarket(documentName, worksheetTitle) {
  const joined = `${documentName} ${worksheetTitle}`.toLowerCase();
  if (/crypto|btc|eth|sol|coin/.test(joined)) return "Crypto";
  if (/egx|egypt|cairo|egp/.test(joined)) return "EGX Equities";
  if (/\bus\b|nyse|nasdaq|sp500|s&p/.test(joined)) return "US Equities";
  return "Other";
}

export function walletTypeFromMarket(market) {
  if (market === "Crypto") return "us_crypto";
  if (market === "US Equities") return "us_equities";
  if (market === "EGX Equities") return "egx_equities";
  return "other";
}

export function buildWalletMetadata(documentName, worksheetTitle, market) {
  return {
    walletId: `${slugify(documentName)}__${slugify(worksheetTitle) || "sheet"}`,
    walletName: `${documentName} / ${worksheetTitle}`,
    walletType: walletTypeFromMarket(market)
  };
}
