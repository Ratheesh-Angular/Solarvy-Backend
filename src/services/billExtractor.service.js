import {
  TextractClient,
  AnalyzeExpenseCommand,
  DetectDocumentTextCommand,
} from "@aws-sdk/client-textract";
import { createWorker } from "tesseract.js";

let textractClient = null;

function getTextractClient() {
  if (!textractClient) {
    textractClient = new TextractClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
  }
  return textractClient;
}

function isAwsCredentialError(error) {
  const msg = String(error?.message || error?.name || "");
  return /credentials|Credential|Could not load credentials|Unauthorized|UnrecognizedClient/i.test(
    msg,
  );
}

function parseAmount(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/[^\d.,]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** OCR often reads ₹ as a leading "3" (e.g. ₹1,246 → 31,246, ₹3.56 → 33.56). */
function fixMisreadCurrencyToken(token) {
  const value = String(token).trim();
  const thousands = value.match(/^3(\d,\d{3}(?:\.\d{2})?)$/);
  if (thousands) return thousands[1];

  const decimal = value.match(/^3(\d\.\d{2})$/);
  if (decimal) return decimal[1];

  return value;
}

function looksLikeAddress(text) {
  return /street|avenue|road|palm|coimbatore|address|nagar|tamil|pincode|\b\d{6}\b/i.test(
    String(text),
  );
}

function parseCurrencyAmount(text) {
  if (!text || looksLikeAddress(text)) return null;

  const matches = [...String(text).matchAll(/([\d,]+(?:\.\d{2})?)/g)];
  if (!matches.length) return null;

  let best = null;
  for (const match of matches) {
    const cleaned = fixMisreadCurrencyToken(match[1]).replace(/,/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (best === null || n > best) best = n;
  }

  return best;
}

function parseKwh(text) {
  if (!text) return null;
  const match = String(text).match(/(\d+(?:\.\d+)?)\s*kwh/i);
  if (match) return Number(match[1]);
  return parseAmount(text);
}

const USAGE_LABEL =
  /monthly\s+electricity\s+usage|electricity\s+usage|energy\s+consumption|units?\s+consumed/i;
const AVG_SPEND_LABEL =
  /average\s+monthly\s+electricity\s+spend|monthly\s+electricity\s+spend/i;
const TOTAL_DUE_LABEL =
  /total\s+amount\s+due|amount\s+due|current\s+charges|bill\s+amount/i;
const TARIFF_LABEL =
  /grid\s+tariff|tariff\s+per\s+kwh|rate\s+per\s+kwh|unit\s+rate|price\s+per\s+kwh/i;

/** Parse label/value pairs and free-form OCR text into bill fields. */
export function parseBillFromText(text, labelValuePairs = []) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let monthlyUsage = null;
  let monthlySpend = null;
  let gridTariff = null;

  const tryAssignUsage = (label, value) => {
    if (monthlyUsage !== null || !USAGE_LABEL.test(label)) return;
    const combined = `${label} ${value}`.trim();
    monthlyUsage = parseKwh(combined) ?? parseKwh(value) ?? parseAmount(value);
  };

  const tryAssignSpend = (label, value) => {
    const combined = `${label} ${value}`.trim();
    const amount = parseCurrencyAmount(combined) ?? parseCurrencyAmount(value);
    if (amount === null) return;

    if (AVG_SPEND_LABEL.test(label)) {
      monthlySpend = amount;
      return;
    }
    if (TOTAL_DUE_LABEL.test(label) && monthlySpend === null) {
      monthlySpend = amount;
    }
  };

  const tryAssignTariff = (label, value) => {
    if (gridTariff !== null || !TARIFF_LABEL.test(label)) return;
    const combined = `${label} ${value}`.trim();
    gridTariff = parseCurrencyAmount(combined) ?? parseCurrencyAmount(value);
  };

  for (const { label, value } of labelValuePairs) {
    tryAssignUsage(label, value);
    tryAssignSpend(label, value);
    tryAssignTariff(label, value);
  }

  const fullText = lines.join("\n");

  if (monthlyUsage === null) {
    const match = fullText.match(
      /monthly\s+electricity\s+usage[^\d]*(\d+(?:\.\d+)?)\s*kwh/i,
    );
    if (match) monthlyUsage = Number(match[1]);
  }

  if (monthlySpend === null) {
    const match = fullText.match(
      /average\s+monthly\s+electricity\s+spend[^\d]*([\d,]+(?:\.\d{2})?)/i,
    );
    if (match) monthlySpend = parseCurrencyAmount(match[1]);
  }

  if (monthlySpend === null) {
    for (let i = 0; i < lines.length; i++) {
      if (!TOTAL_DUE_LABEL.test(lines[i])) continue;

      const fromLine = parseCurrencyAmount(lines[i]);
      if (fromLine !== null) {
        monthlySpend = fromLine;
        break;
      }

      const fromNext = parseCurrencyAmount(lines[i + 1] || "");
      if (fromNext !== null) {
        monthlySpend = fromNext;
        break;
      }
    }
  }

  if (gridTariff === null) {
    const match = fullText.match(
      /grid\s+tariff\s+per\s+kwh[^\d]*([\d,]+(?:\.\d{2})?)/i,
    );
    if (match) gridTariff = parseCurrencyAmount(match[1]);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || "";

    if (monthlyUsage === null && USAGE_LABEL.test(line)) {
      monthlyUsage =
        parseKwh(line) ?? parseKwh(next) ?? parseAmount(next);
    }

    if (AVG_SPEND_LABEL.test(line)) {
      monthlySpend =
        parseCurrencyAmount(line) ?? parseCurrencyAmount(next) ?? monthlySpend;
    } else if (monthlySpend === null && TOTAL_DUE_LABEL.test(line)) {
      monthlySpend =
        parseCurrencyAmount(line) ?? parseCurrencyAmount(next);
    }

    if (gridTariff === null && TARIFF_LABEL.test(line)) {
      gridTariff = parseCurrencyAmount(line) ?? parseCurrencyAmount(next);
    }

    const colonMatch = line.match(/^(.+?)[:\-]\s*(.+)$/);
    if (colonMatch) {
      tryAssignUsage(colonMatch[1], colonMatch[2]);
      tryAssignSpend(colonMatch[1], colonMatch[2]);
      tryAssignTariff(colonMatch[1], colonMatch[2]);
    }
  }

  return { monthlyUsage, monthlySpend, gridTariff };
}

function collectTextractExpenseFields(response) {
  const fields = [];
  for (const doc of response.ExpenseDocuments ?? []) {
    for (const field of doc.SummaryFields ?? []) {
      fields.push({
        label: field.LabelDetection?.Text || field.Type?.Text || "",
        value: field.ValueDetection?.Text || "",
      });
    }
    for (const group of doc.LineItemGroups ?? []) {
      for (const item of group.LineItems ?? []) {
        for (const f of item.LineItemExpenseFields ?? []) {
          fields.push({
            label: f.LabelDetection?.Text || f.Type?.Text || "",
            value: f.ValueDetection?.Text || "",
          });
        }
      }
    }
  }
  return fields;
}

function collectTextractLines(response) {
  return (response.Blocks ?? [])
    .filter((block) => block.BlockType === "LINE" && block.Text)
    .map((block) => block.Text)
    .join("\n");
}

async function extractWithTextract(fileBuffer) {
  const client = getTextractClient();

  const [expenseResult, textResult] = await Promise.all([
    client.send(new AnalyzeExpenseCommand({ Document: { Bytes: fileBuffer } })),
    client.send(
      new DetectDocumentTextCommand({ Document: { Bytes: fileBuffer } }),
    ),
  ]);

  const fields = collectTextractExpenseFields(expenseResult);
  const ocrText = collectTextractLines(textResult);
  const parsed = parseBillFromText(ocrText, fields);

  return {
    ...parsed,
    fieldsDetected: fields.length + (ocrText ? ocrText.split("\n").length : 0),
    source: "textract",
  };
}

async function extractWithTesseract(fileBuffer) {
  const worker = await createWorker("eng");
  try {
    const {
      data: { text },
    } = await worker.recognize(fileBuffer);
    const parsed = parseBillFromText(text);
    return {
      ...parsed,
      fieldsDetected: text ? text.split(/\r?\n/).filter(Boolean).length : 0,
      source: "tesseract",
    };
  } finally {
    await worker.terminate();
  }
}

function hasAnyValue(result) {
  return (
    result.monthlyUsage !== null ||
    result.monthlySpend !== null ||
    result.gridTariff !== null
  );
}

/**
 * Extract monthly usage / spend / tariff from a utility bill image or PDF.
 * Uses AWS Textract in production; falls back to Tesseract when AWS is unavailable.
 */
export async function extractBillValues(fileBuffer) {
  const preferLocal = process.env.BILL_OCR_FALLBACK === "tesseract";

  if (preferLocal) {
    return extractWithTesseract(fileBuffer);
  }

  try {
    const textractResult = await extractWithTextract(fileBuffer);
    if (hasAnyValue(textractResult)) {
      return textractResult;
    }

    // Textract succeeded but found nothing — try local OCR as a second pass
    const tesseractResult = await extractWithTesseract(fileBuffer);
    if (hasAnyValue(tesseractResult)) {
      return tesseractResult;
    }

    return textractResult;
  } catch (error) {
    if (isAwsCredentialError(error)) {
      console.warn(
        "AWS Textract unavailable — using local OCR fallback:",
        error.message,
      );
      return extractWithTesseract(fileBuffer);
    }
    throw error;
  }
}
