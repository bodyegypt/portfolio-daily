#!/usr/bin/env node
import path from "node:path";
import { loadConfig } from "./config.js";
import { createSheetsApi, fetchSpreadsheetDocument } from "./googleSheets.js";
import { parseWorksheet } from "./parser.js";
import { aggregatePositions, analyzePortfolio } from "./analysis.js";
import { printConsoleSummary, writeReports } from "./reporting.js";
import { buildWalletMetadata, classifyMarket } from "./wallets.js";
import { computeHealthScore, healthScoreToMarkdown } from "./healthScore.js";
import { buildHistoricalTrends } from "./history.js";
import { buildDiffReport, diffToMarkdown } from "./diff.js";
import { renderSparklineTable, renderPortfolioSparkline, sparklineToMarkdown } from "./sparklines.js";
import { writeHtmlReport } from "./htmlReport.js";

function parseArgs(argv) {
  const out = {
    config: "inputs.json",
    outputDir: "reports",
    date: null,
    noHtml: false,
    diff: null,
    lookback: 7
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config" && argv[i + 1]) {
      out.config = argv[i + 1];
      i += 1;
    } else if (token === "--output-dir" && argv[i + 1]) {
      out.outputDir = argv[i + 1];
      i += 1;
    } else if (token === "--date" && argv[i + 1]) {
      out.date = argv[i + 1];
      i += 1;
    } else if (token === "--no-html") {
      out.noHtml = true;
    } else if (token === "--diff" && argv[i + 1]) {
      out.diff = argv[i + 1];
      i += 1;
    } else if (token === "--lookback" && argv[i + 1]) {
      out.lookback = parseInt(argv[i + 1], 10) || 7;
      i += 1;
    } else if (token === "--help" || token === "-h") {
      console.log(
        [
          "Usage: npm run daily -- [options]",
          "",
          "Options:",
          "  --config <path>       Config file (default: inputs.json)",
          "  --output-dir <path>   Report output directory (default: reports)",
          "  --date <YYYY-MM-DD>   Report date (default: today)",
          "  --no-html             Skip HTML report generation",
          "  --diff <YYYY-MM-DD>   Compare against a specific date",
          "  --lookback <days>     Historical trend lookback (default: 7)",
          "  --help, -h            Show this help"
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return out;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeErrorMessage(message) {
  return String(message ?? "").replace(/([?&]key=)[^&\s]+/gi, "$1***");
}

async function main() {
  const args = parseArgs(process.argv);
  const reportDate = args.date ?? todayString();

  const config = await loadConfig(args.config);
  const authMode = config.googleApiKey ? "api_key" : "oauth_or_adc";
  const sheetsApi = await createSheetsApi({ apiKey: config.googleApiKey });

  const worksheetReports = [];
  const positionsByCurrency = new Map();
  const weirdByCurrency = new Map();
  const adjustmentsByCurrency = new Map();
  const positionsByMarketCurrency = new Map();
  const weirdByMarketCurrency = new Map();
  const adjustmentsByMarketCurrency = new Map();
  const failures = [];

  for (const doc of config.documents) {
    try {
      const documentData = await fetchSpreadsheetDocument(sheetsApi, doc);
      for (const worksheet of documentData.worksheets) {
        const parsed = parseWorksheet(worksheet.values, doc.name, worksheet.title);
        const currency = doc.currency || config.baseCurrency;
        const market = classifyMarket(doc.name, worksheet.title);
        const wallet = buildWalletMetadata(doc.name, worksheet.title, market);
        positionsByCurrency.set(currency, [
          ...(positionsByCurrency.get(currency) ?? []),
          ...parsed.positions
        ]);
        weirdByCurrency.set(currency, [...(weirdByCurrency.get(currency) ?? []), ...parsed.weirdValues]);
        adjustmentsByCurrency.set(currency, [
          ...(adjustmentsByCurrency.get(currency) ?? []),
          ...(parsed.adjustments ?? [])
        ]);
        const marketCurrencyKey = `${market}::${currency}`;
        positionsByMarketCurrency.set(marketCurrencyKey, [
          ...(positionsByMarketCurrency.get(marketCurrencyKey) ?? []),
          ...parsed.positions
        ]);
        weirdByMarketCurrency.set(marketCurrencyKey, [
          ...(weirdByMarketCurrency.get(marketCurrencyKey) ?? []),
          ...parsed.weirdValues
        ]);
        adjustmentsByMarketCurrency.set(marketCurrencyKey, [
          ...(adjustmentsByMarketCurrency.get(marketCurrencyKey) ?? []),
          ...(parsed.adjustments ?? [])
        ]);

        const aggregated = aggregatePositions(parsed.positions);
        const analysis = analyzePortfolio({
          label: wallet.walletName,
          positions: aggregated,
          weirdValues: parsed.weirdValues,
          risk: config.risk,
          adjustments: parsed.adjustments ?? []
        });
        worksheetReports.push({
          ...wallet,
          documentName: doc.name,
          documentTitle: documentData.documentTitle,
          worksheetTitle: worksheet.title,
          market,
          currency,
          headerRows: parsed.headerRows,
          analysis
        });
      }
    } catch (error) {
      failures.push(`${doc.name}: ${sanitizeErrorMessage(error.message)}`);
    }
  }

  const combinedByCurrency = [...positionsByCurrency.entries()].map(([currency, rawPositions]) => {
    const aggregated = aggregatePositions(rawPositions);
    return {
      currency,
        analysis: analyzePortfolio({
          label: `Combined (${currency})`,
          positions: aggregated,
          weirdValues: weirdByCurrency.get(currency) ?? [],
          risk: config.risk,
          adjustments: adjustmentsByCurrency.get(currency) ?? []
        })
      };
  });
  const singleCurrency = combinedByCurrency.length === 1 ? combinedByCurrency[0] : null;
  const markets = [...positionsByMarketCurrency.entries()].map(([key, rawPositions]) => {
    const [market, currency] = key.split("::");
    const aggregated = aggregatePositions(rawPositions);
    return {
      market,
      currency,
        analysis: analyzePortfolio({
          label: `${market} (${currency})`,
          positions: aggregated,
          weirdValues: weirdByMarketCurrency.get(key) ?? [],
          risk: config.risk,
          adjustments: adjustmentsByMarketCurrency.get(key) ?? []
        })
      };
  });

  const dailyReport = {
    date: reportDate,
    baseCurrency: config.baseCurrency,
    configUsed: {
      documentCount: config.documents.length,
      currencies: [...new Set(config.documents.map((item) => item.currency))],
      watchlistCount: config.watchlist.length,
      authMode,
      risk: config.risk
    },
    failures,
    worksheets: worksheetReports,
    markets,
    combined: singleCurrency ? singleCurrency.analysis : null,
    combinedCurrency: singleCurrency ? singleCurrency.currency : null,
    combinedByCurrency,
    mixedCurrency: combinedByCurrency.length > 1
  };

  const outputDir = path.resolve(args.outputDir);

  // Write core reports (markdown + JSON)
  const { markdownPath, jsonPath } = await writeReports(dailyReport, outputDir);

  // Compute health score
  const healthScore = computeHealthScore(dailyReport);
  dailyReport.healthScore = healthScore;

  // Build historical trends and diff (non-blocking — uses previously written reports)
  const currency = dailyReport.combinedCurrency || dailyReport.baseCurrency;
  const [trends, diff] = await Promise.all([
    buildHistoricalTrends(outputDir, reportDate, args.lookback).catch(() => null),
    buildDiffReport(outputDir, reportDate, args.diff).catch(() => null)
  ]);

  if (trends) dailyReport.trends = trends;
  if (diff) dailyReport.diff = diff;

  // Re-write JSON with enriched data
  const fs = await import("node:fs/promises");
  await fs.writeFile(jsonPath, JSON.stringify(dailyReport, null, 2), "utf8");

  // Append enrichments to markdown
  let enrichedMd = "";
  enrichedMd += healthScoreToMarkdown(healthScore);
  if (diff?.available) enrichedMd += diffToMarkdown(diff, currency);
  if (trends?.available) enrichedMd += sparklineToMarkdown(trends);
  if (enrichedMd) {
    const existingMd = await fs.readFile(markdownPath, "utf8");
    await fs.writeFile(markdownPath, existingMd + "\n" + enrichedMd, "utf8");
  }

  // Generate HTML report
  let htmlPath = null;
  if (!args.noHtml) {
    htmlPath = await writeHtmlReport(dailyReport, outputDir, healthScore, diff, trends);
  }

  // Console output
  printConsoleSummary(dailyReport, markdownPath, jsonPath);

  // Print health score to console
  console.log(`Health: ${healthScore.bar} (${healthScore.label})`);

  // Print sparklines to console if trends are available
  if (trends?.available) {
    console.log(renderPortfolioSparkline(trends));
    console.log(renderSparklineTable(trends, currency));
  }

  if (htmlPath) console.log(`HTML: ${htmlPath}`);
}

main().catch((error) => {
  console.error(`portfolio-daily failed: ${error.message}`);
  process.exit(1);
});
