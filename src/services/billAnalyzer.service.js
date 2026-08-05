import {
  BILL_ANALYZER_SETTING_KEY,
  BILL_ANALYZER_USER_PROMPT,
  DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT,
} from "../config/billAnalyzerDefaults.js";
import { getSetting } from "../repositories/appSettings.repository.js";
import { completeVisionJson } from "./openai.service.js";
import {
  getConfidenceMin,
  validateAndMapBillExtraction,
} from "./billValidation.service.js";

async function loadSystemPrompt() {
  try {
    const row = await getSetting(BILL_ANALYZER_SETTING_KEY);
    const value = row?.value?.trim();
    if (value) return value;
  } catch (error) {
    console.warn(
      "billAnalyzer: could not load prompt from app_settings, using default:",
      error.message,
    );
  }
  return DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT;
}

function parseJsonContent(content) {
  const trimmed = String(content).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("OpenAI bill analysis did not return valid JSON");
  }
}

/**
 * Analyze an electricity bill image/PDF with OpenAI Vision and map form fields.
 */
export async function analyzeBillDocument(fileBuffer, options = {}) {
  const mimeType = options.mimeType || "image/jpeg";
  const fileName = options.fileName || "bill";

  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length === 0) {
    throw new Error("Empty bill upload");
  }

  const systemPrompt = await loadSystemPrompt();
  const mediaBase64 = fileBuffer.toString("base64");

  console.log(
    `billAnalyzer: analyzing ${fileName} (${mimeType}, ${fileBuffer.length} bytes) with OpenAI`,
  );

  const content = await completeVisionJson({
    systemPrompt,
    userPrompt: BILL_ANALYZER_USER_PROMPT,
    mediaBase64,
    mimeType,
    fileName,
  });

  const parsed = parseJsonContent(content);
  const mapped = validateAndMapBillExtraction(parsed);
  const confidenceMin = getConfidenceMin();
  const lowConfidence =
    mapped.confidence < confidenceMin || mapped.fieldsDetected === 0;

  if (lowConfidence) {
    mapped.warnings = [
      ...mapped.warnings,
      "Low confidence or incomplete extraction — verify or enter values manually.",
    ];
  }

  return {
    monthlyUsage: mapped.monthlyUsage,
    monthlySpend: mapped.monthlySpend,
    gridTariff: mapped.gridTariff,
    confidence: mapped.confidence,
    confidenceMin,
    lowConfidence,
    warnings: mapped.warnings,
    fieldsDetected: mapped.fieldsDetected,
    raw: mapped.raw,
    source: "openai",
  };
}
