import {
  DEFAULT_QUICK_SNAPSHOT_RECOMMENDATION_SYSTEM_PROMPT,
  DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
  QUICK_SNAPSHOT_RECOMMENDATION_MAX_CHARS,
  QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
  QUICK_SNAPSHOT_RECOMMENDATION_USER_PROMPT,
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

function stripStoredRecommendations(results) {
  if (!results || typeof results !== "object") return results;
  const {
    aiRecommendation: _ignoredAi,
    quickSnapshotRecommendation: _ignoredQs,
    ...excel
  } = results;
  return excel;
}

function buildUserPrompt(formData, results, userPromptTemplate) {
  const context = {
    form: formData ?? null,
    excel: stripStoredRecommendations(results) ?? null,
  };

  return `${userPromptTemplate}

ASSESSMENT_CONTEXT (JSON)
${JSON.stringify(context, null, 2)}

Use these values when the system prompt refers to them. Prefer the Excel-flagged recommended strategy.`;
}

async function loadSystemPrompt(settingKey, defaultPrompt) {
  try {
    const row = await getSetting(settingKey);
    const value = row?.value?.trim();
    if (value) return withRecommendationContextPreamble(value);
  } catch (error) {
    console.warn(
      "recommendation: could not load prompt from app_settings, using default:",
      error.message,
    );
  }
  return withRecommendationContextPreamble(defaultPrompt);
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

function normalizeRecommendation(content, maxChars) {
  let text = String(content || "").trim();
  const fenced = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  return truncateAtSentence(text, maxChars);
}

async function generateWithPrompt({
  formData,
  results,
  settingKey,
  defaultPrompt,
  userPromptTemplate,
  maxChars,
  logLabel,
}) {
  try {
    const form = parseObject(formData) ?? formData ?? null;
    const excel = parseObject(results) ?? results ?? null;
    if (!excel || excel.calculationError) return null;

    const systemPrompt = await loadSystemPrompt(settingKey, defaultPrompt);
    const userPrompt = buildUserPrompt(form, excel, userPromptTemplate);

    console.log(`recommendation: generating ${logLabel} with OpenAI`);

    const content = await completeChatText({ systemPrompt, userPrompt });
    return normalizeRecommendation(content, maxChars);
  } catch (error) {
    console.warn(`recommendation: ${logLabel} generation failed:`, error.message);
    return null;
  }
}

export async function generateRecommendation(formData, results) {
  return generateWithPrompt({
    formData,
    results,
    settingKey: RECOMMENDATION_SETTING_KEY,
    defaultPrompt: DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
    userPromptTemplate: RECOMMENDATION_USER_PROMPT,
    maxChars: RECOMMENDATION_MAX_CHARS,
    logLabel: "AI recommendation",
  });
}

export async function generateQuickSnapshotRecommendation(formData, results) {
  return generateWithPrompt({
    formData,
    results,
    settingKey: QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
    defaultPrompt: DEFAULT_QUICK_SNAPSHOT_RECOMMENDATION_SYSTEM_PROMPT,
    userPromptTemplate: QUICK_SNAPSHOT_RECOMMENDATION_USER_PROMPT,
    maxChars: QUICK_SNAPSHOT_RECOMMENDATION_MAX_CHARS,
    logLabel: "quick snapshot recommendation",
  });
}

export async function withAiRecommendation(formData, results) {
  if (!results || typeof results !== "object") return results;
  if (results.calculationError) return results;
  if (String(results.aiRecommendation || "").trim()) return results;

  const text = await generateRecommendation(formData, results);
  if (!text) return results;
  return { ...results, aiRecommendation: text };
}

export async function withQuickSnapshotRecommendation(formData, results) {
  if (!results || typeof results !== "object") return results;
  if (results.calculationError) return results;
  if (String(results.quickSnapshotRecommendation || "").trim()) return results;

  const text = await generateQuickSnapshotRecommendation(formData, results);
  if (!text) return results;
  return { ...results, quickSnapshotRecommendation: text };
}
