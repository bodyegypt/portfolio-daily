import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { aggregatePositions, analyzePortfolio } from "../src/analysis.js";
import { loadConfig } from "../src/config.js";
import { parseWorksheet } from "../src/parser.js";
import { toMarkdown } from "../src/reporting.js";
import { buildWalletMetadata, classifyMarket } from "../src/wallets.js";

test("parseWorksheet skips totals and keeps accounting adjustments", () => {
  const values = [
    ["Ticker", "Qty", "Avg Cost", "Price", "Market Value", "P&L %"],
    ["AAA", "10", "2", "3", "30", "50%"],
    ["Subtotal", "", "", "", "30", ""],
    ["OLD LOSS", "", "", "1570", "", ""],
    ["BBB", "1,5", "10,0", "11,0", "16,5", "10,0%"],
    ["CCC", "1,234", "2", "2", "2468", "0%"]
  ];

  const parsed = parseWorksheet(values, "Thndr US", "Crypto");
  assert.equal(parsed.positions.length, 3);
  assert.equal(parsed.adjustments.length, 1);
  assert.equal(parsed.adjustments[0].kind, "loss_carry");
  assert.equal(parsed.adjustments[0].amount, 1570);

  const bbb = parsed.positions.find((item) => item.symbol === "BBB");
  assert.equal(bbb.quantity, 1.5);
  assert.equal(bbb.pnlPct, 0.1);

  const ccc = parsed.positions.find((item) => item.symbol === "CCC");
  assert.equal(ccc.quantity, 1234);
});

test("aggregatePositions consolidates repeated symbols", () => {
  const aggregated = aggregatePositions([
    { symbol: "AAA", quantity: 1, spent: 10, marketValue: 12, pnl: 2, pnlPct: 0.2 },
    { symbol: "AAA", quantity: 2, spent: 30, marketValue: 35, pnl: 5, pnlPct: 0.1667 },
    { symbol: "BBB", quantity: 1, spent: 5, marketValue: 4, pnl: -1, pnlPct: -0.2 }
  ]);

  assert.equal(aggregated.length, 2);
  const aaa = aggregated.find((item) => item.symbol === "AAA");
  assert.equal(aaa.quantity, 3);
  assert.equal(aaa.spent, 40);
  assert.equal(aaa.marketValue, 47);
  assert.equal(aaa.pnl, 7);
});

test("analyzePortfolio remains factual-only", () => {
  const report = analyzePortfolio({
    label: "Wallet A",
    positions: [{ symbol: "AAA", quantity: 1, spent: 100, marketValue: 90, pnl: -10, pnlPct: -0.1 }],
    weirdValues: [],
    risk: {
      maxPositionWeight: 0.2,
      top3ConcentrationWarn: 0.55,
      drawdownWarnPct: -0.15,
      takeProfitWarnPct: 0.25,
      minPositionWeight: 0.02
    },
    adjustments: []
  });

  assert.ok(!("actions" in report));
  assert.ok(!("deepInsights" in report));
  assert.ok(!("checklist" in report));
  assert.equal(report.positionCount, 1);
});

test("toMarkdown renders wallet metadata and factual sections", () => {
  const analysis = analyzePortfolio({
    label: "Thndr US / Sheet1",
    positions: [{ symbol: "AAA", quantity: 1, spent: 100, marketValue: 120, pnl: 20, pnlPct: 0.2 }],
    weirdValues: [],
    risk: {
      maxPositionWeight: 0.2,
      top3ConcentrationWarn: 0.55,
      drawdownWarnPct: -0.15,
      takeProfitWarnPct: 0.25,
      minPositionWeight: 0.02
    },
    adjustments: []
  });

  const dailyReport = {
    date: "2026-02-14",
    baseCurrency: "USD",
    failures: [],
    mixedCurrency: false,
    combined: analysis,
    combinedCurrency: "USD",
    combinedByCurrency: [{ currency: "USD", analysis }],
    markets: [],
    worksheets: [
      {
        walletId: "thndr-us__sheet1",
        walletName: "Thndr US / Sheet1",
        walletType: "us_equities",
        documentName: "Thndr US",
        worksheetTitle: "Sheet1",
        market: "US Equities",
        currency: "USD",
        analysis
      }
    ]
  };

  const markdown = toMarkdown(dailyReport);
  assert.match(markdown, /## Per Wallet/);
  assert.match(markdown, /Wallet ID: thndr-us__sheet1/);
  assert.match(markdown, /Wallet Type: us_equities/);
  assert.doesNotMatch(markdown, /Deep Insights/i);
});

test("loadConfig validates document URLs and prefers env API key", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "portfolio-config-"));
  const validPath = path.join(tempDir, "inputs.valid.json");
  const invalidPath = path.join(tempDir, "inputs.invalid.json");

  await fs.writeFile(
    validPath,
    JSON.stringify({
      googleApiKey: "inline-key",
      documents: [
        {
          name: "US",
          url: "https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing",
          currency: "usd"
        }
      ]
    }),
    "utf8"
  );

  await fs.writeFile(
    invalidPath,
    JSON.stringify({
      documents: [{ name: "US", url: "https://example.com/not-sheet", currency: "USD" }]
    }),
    "utf8"
  );

  const previous = process.env.GOOGLE_API_KEY;
  process.env.GOOGLE_API_KEY = "env-key";
  try {
    const loaded = await loadConfig(validPath);
    assert.equal(loaded.googleApiKey, "env-key");
  } finally {
    if (previous === undefined) {
      delete process.env.GOOGLE_API_KEY;
    } else {
      process.env.GOOGLE_API_KEY = previous;
    }
  }

  await assert.rejects(loadConfig(invalidPath), /must be a Google Sheets document URL/);
});

test("wallet helpers keep US equities and US crypto as separate wallet types", () => {
  const equitiesMarket = classifyMarket("Thndr US", "Sheet1");
  const cryptoMarket = classifyMarket("Thndr US", "Crypto");

  const equitiesWallet = buildWalletMetadata("Thndr US", "Sheet1", equitiesMarket);
  const cryptoWallet = buildWalletMetadata("Thndr US", "Crypto", cryptoMarket);

  assert.equal(equitiesMarket, "US Equities");
  assert.equal(cryptoMarket, "Crypto");
  assert.equal(equitiesWallet.walletType, "us_equities");
  assert.equal(cryptoWallet.walletType, "us_crypto");
  assert.notEqual(equitiesWallet.walletId, cryptoWallet.walletId);
});
