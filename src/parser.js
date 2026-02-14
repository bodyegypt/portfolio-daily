const FIELD_ALIASES = {
  symbol: [
    "ticker",
    "symbol",
    "asset",
    "stock",
    "stcok",
    "security",
    "instrument",
    "position",
    "company",
    "name"
  ],
  quantity: ["qty", "quantity", "shares", "units", "owned"],
  avgCost: ["avg cost", "average cost", "cost/share", "entry price", "buy price", "cost basis"],
  spent: ["spent", "invested", "capital", "book value", "total cost", "amount paid"],
  price: ["price", "current price", "market price", "last price", "close"],
  marketValue: ["market value", "position value", "current value", "value"],
  pnl: ["p&l", "p/l", "pnl", "unrealized p&l", "gain/loss", "profit/loss", "gain", "profit"],
  pnlPct: [
    "p&l %",
    "% p&l",
    "%p&l",
    "p/l %",
    "% p/l",
    "%p/l",
    "pnl %",
    "% pnl",
    "%pnl",
    "return %",
    "gain %",
    "profit %",
    "change %"
  ]
};

function normalizeHeader(text) {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[^a-z0-9%/&. ]/g, "")
    .trim();
}

function normalizeNumericText(rawValue) {
  let text = String(rawValue ?? "").trim();
  if (!text) return text;

  text = text.replace(/[−–—]/g, "-");
  text = text.replace(/\b[A-Z]{3}\b/gi, "");
  text = text.replace(/[$€£¥]/g, "");
  text = text.replace(/\s+/g, "");

  const hasDot = text.includes(".");
  const hasComma = text.includes(",");
  if (hasDot && hasComma) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(/,/g, ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    const commaCount = (text.match(/,/g) ?? []).length;
    if (commaCount === 1 && /,\d{1,4}$/.test(text)) {
      const [left, right] = text.split(",");
      const rightIsThousandsLike = /^\d{3}$/.test(right) && /^\d+$/.test(left);
      text = rightIsThousandsLike ? `${left}${right}` : `${left}.${right}`;
    } else {
      text = text.replace(/,/g, "");
    }
  }

  return text;
}

function parseNumber(value, forcePercent = false) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "-" || raw === "--") return null;

  let text = raw;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  }

  const hasPercent = text.endsWith("%");
  text = normalizeNumericText(text.replace(/%$/g, ""));

  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return null;

  let number = negative ? parsed * -1 : parsed;
  if (hasPercent || forcePercent) {
    if (Math.abs(number) > 1) number /= 100;
  }
  return number;
}

function isBlankRow(row) {
  const cells = Array.isArray(row) ? row : [];
  return cells.every((cell) => !String(cell ?? "").trim());
}

function isTotalLikeLabel(label) {
  return /^(grand total|subtotal|sub total|total|totals|net total)$/i.test(label);
}

function isTotalRow(row) {
  const cells = Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : [];
  if (!cells.length) return false;

  for (let index = 0; index < cells.length; index += 1) {
    const normalized = normalizeHeader(cells[index]);
    if (!isTotalLikeLabel(normalized)) continue;
    const beforeCount = cells.slice(0, index).filter(Boolean).length;
    if (beforeCount <= 1) return true;
  }

  const merged = cells.map((cell) => normalizeHeader(cell)).filter(Boolean).join(" ");
  return /^(grand total|subtotal|sub total|total|net total)\b/.test(merged);
}

function detectHeaderMapping(row) {
  const usedFields = new Set();
  const mapping = new Map();

  row.forEach((cell, index) => {
    const label = normalizeHeader(cell);
    if (!label) return;
    const labelHasPercent = label.includes("%");

    let bestMatch = null;
    let bestLength = -1;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (usedFields.has(field)) continue;
      for (const alias of aliases) {
        const aliasNorm = normalizeHeader(alias);
        const aliasHasPercent = aliasNorm.includes("%");
        const fieldIsPercent = field.toLowerCase().endsWith("pct");
        if (labelHasPercent && !fieldIsPercent && !aliasHasPercent) continue;
        if (!labelHasPercent && fieldIsPercent && aliasHasPercent) continue;
        if (aliasNorm && label.includes(aliasNorm) && aliasNorm.length > bestLength) {
          bestMatch = field;
          bestLength = aliasNorm.length;
        }
      }
    }

    if (bestMatch) {
      mapping.set(index, bestMatch);
      usedFields.add(bestMatch);
    }
  });

  return mapping;
}

function isHeaderCandidate(mapping) {
  const fields = new Set(mapping.values());
  return fields.has("symbol") && fields.size >= 2;
}

function rowFieldValue(row, mapping, field) {
  for (const [index, mappedField] of mapping.entries()) {
    if (mappedField === field) return String(row[index] ?? "").trim();
  }
  return "";
}

function parsePositionRow(row, mapping, documentName, worksheetTitle) {
  const symbol = rowFieldValue(row, mapping, "symbol");
  if (!symbol) return { position: null, weird: null };

  const quantity = parseNumber(rowFieldValue(row, mapping, "quantity"));
  const avgCost = parseNumber(rowFieldValue(row, mapping, "avgCost"));
  let spent = parseNumber(rowFieldValue(row, mapping, "spent"));
  const price = parseNumber(rowFieldValue(row, mapping, "price"));
  let marketValue = parseNumber(rowFieldValue(row, mapping, "marketValue"));
  let pnl = parseNumber(rowFieldValue(row, mapping, "pnl"));
  let pnlPct = parseNumber(rowFieldValue(row, mapping, "pnlPct"), true);

  if (spent === null && quantity !== null && avgCost !== null) spent = quantity * avgCost;
  if (marketValue === null && quantity !== null && price !== null) marketValue = quantity * price;
  if (pnl === null && marketValue !== null && spent !== null) pnl = marketValue - spent;
  if (pnlPct === null && pnl !== null && spent !== null && spent !== 0) pnlPct = pnl / spent;

  if ([quantity, spent, marketValue, pnl, pnlPct].every((value) => value === null)) {
    return { position: null, weird: null };
  }

  let weird = null;
  if (marketValue === null) {
    weird = `${documentName}/${worksheetTitle}: Missing market value for '${symbol}'.`;
  } else if (marketValue < 0) {
    weird = `${documentName}/${worksheetTitle}: Negative market value for '${symbol}'.`;
  } else if (quantity !== null && quantity < 0) {
    weird = `${documentName}/${worksheetTitle}: Negative quantity for '${symbol}'.`;
  }

  return {
    position: {
      symbol,
      quantity,
      avgCost,
      spent,
      price,
      marketValue,
      pnl,
      pnlPct,
      sourceDocument: documentName,
      sourceWorksheet: worksheetTitle
    },
    weird
  };
}

function parseAdjustmentRow(row, documentName, worksheetTitle, rowIndex) {
  const cells = row.map((cell) => String(cell ?? "").trim());
  const normalized = cells.map((cell) => normalizeHeader(cell));
  const labelIndex = normalized.findIndex((cell) =>
    /(old loss|realized loss|carry loss|loss carry|prior loss|accumulated loss)/.test(cell)
  );
  if (labelIndex < 0) return null;

  let amount = null;
  for (let idx = labelIndex + 1; idx < cells.length; idx += 1) {
    const parsed = parseNumber(cells[idx]);
    if (Number.isFinite(parsed)) {
      amount = parsed;
      break;
    }
  }
  if (amount === null) {
    for (let idx = labelIndex - 1; idx >= 0; idx -= 1) {
      const parsed = parseNumber(cells[idx]);
      if (Number.isFinite(parsed)) {
        amount = parsed;
        break;
      }
    }
  }
  if (amount === null) return null;

  const lossAmount = Math.abs(amount);
  return {
    kind: "loss_carry",
    label: cells[labelIndex] || "OLD LOSS",
    amount: lossAmount,
    spentDelta: lossAmount,
    marketValueDelta: 0,
    pnlDelta: -lossAmount,
    sourceDocument: documentName,
    sourceWorksheet: worksheetTitle,
    rowIndex
  };
}

export function parseWorksheet(values, documentName, worksheetTitle) {
  const adjustments = [];
  values?.forEach((row, rowIndex) => {
    const parsed = parseAdjustmentRow(Array.isArray(row) ? row : [], documentName, worksheetTitle, rowIndex);
    if (parsed) adjustments.push(parsed);
  });

  if (!values?.length) {
    return {
      positions: [],
      weirdValues: ["Worksheet is empty."],
      headerRows: [],
      adjustments
    };
  }

  const headers = [];
  values.forEach((row, index) => {
    const mapping = detectHeaderMapping(Array.isArray(row) ? row : []);
    if (isHeaderCandidate(mapping)) headers.push({ index, mapping });
  });

  if (!headers.length) {
    return {
      positions: [],
      weirdValues: ["No holdings-like header detected."],
      headerRows: [],
      adjustments
    };
  }

  const positions = [];
  const weirdValues = [];
  const headerRows = headers.map((item) => item.index);

  headers.forEach((header, headerIndex) => {
    const endRow = headers[headerIndex + 1]?.index ?? values.length;
    let blankCount = 0;

    for (let rowIndex = header.index + 1; rowIndex < endRow; rowIndex += 1) {
      const row = Array.isArray(values[rowIndex]) ? values[rowIndex] : [];
      if (isBlankRow(row)) {
        blankCount += 1;
        if (blankCount >= 2) break;
        continue;
      }
      blankCount = 0;
      if (isTotalRow(row)) continue;

      const { position, weird } = parsePositionRow(
        row,
        header.mapping,
        documentName,
        worksheetTitle
      );
      if (position) positions.push(position);
      if (weird) weirdValues.push(weird);
    }
  });

  if (!positions.length) weirdValues.push("No position rows parsed under detected headers.");
  return { positions, weirdValues, headerRows, adjustments };
}
