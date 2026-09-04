import {
  DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
  RECOMMENDATION_MAX_CHARS,
  RECOMMENDATION_SETTING_KEY,
  RECOMMENDATION_USER_PROMPT,
  withRecommendationContextPreamble,
} from "../config/recommendationDefaults.js";
import { getSetting } from "../repositories/appSettings.repository.js";
import { completeChatText } from "./openai.service.js";

function parseObject(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function stripAiRecommendation(results) {
  if (!results || typeof results !== "object") return results;
  const { aiRecommendation: _ignored, ...excel } = results;
  return excel;
}

function buildUserPrompt(formData, results) {
  const context = {
    form: formData ?? null,
    excel: stripAiRecommendation(results) ?? null,
  };

  return `${RECOMMENDATION_USER_PROMPT}

ASSESSMENT_CONTEXT (JSON)
${JSON.stringify(context, null, 2)}

Use these values when the system prompt refers to them. Prefer the Excel-flagged recommended strategy.`;
}

async function loadSystemPrompt() {
  try {
    const row = await getSetting(RECOMMENDATION_SETTING_KEY);
    const value = row?.value?.trim();
    if (value) return withRecommendationContextPreamble(value);
  } catch (error) {
    console.warn(
      "recommendation: could not load prompt from app_settings, using default:",
      error.message,
    );
  }
  return withRecommendationContextPreamble(DEFAULT_RECOMMENDATION_SYSTEM_PROMPT);
}

function truncateAtSentence(text, maxChars) {
  if (text.length <= maxChars) return text;
  const sliced = text.slice(0, maxChars);
  const lastStop = Math.max(
    sliced.lastIndexOf(". "),
    sliced.lastIndexOf("? "),
    sliced.lastIndexOf("! "),
  );
  if (lastStop >= Math.floor(maxChars * 0.6)) {
    return sliced.slice(0, lastStop + 1).trim();
  }
  return sliced.trim();
}

function normalizeRecommendation(content) {
  let text = String(content || "").trim();
  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  return truncateAtSentence(text, RECOMMENDATION_MAX_CHARS);
}

export async function generateRecommendation(formData, results) {
  try {
    const form = parseObject(formData) ?? formData ?? null;
    const excel = parseObject(results) ?? results ?? null;
    if (!excel || excel.calculationError) return null;

    const systemPrompt = await loadSystemPrompt();
    const userPrompt = buildUserPrompt(form, excel);

    console.log("recommendation: generating AI recommendation with OpenAI");

    const content = await completeChatText({ systemPrompt, userPrompt });
    return normalizeRecommendation(content);
  } catch (error) {
    console.warn("recommendation: OpenAI generation failed:", error.message);
    return null;
  }
}

export async function withAiRecommendation(formData, results) {
  if (!results || typeof results !== "object") return results;
  if (results.calculationError) return results;
  if (String(results.aiRecommendation || "").trim()) return results;

  const text = await generateRecommendation(formData, results);
  if (!text) return results;
  return { ...results, aiRecommendation: text };
}
