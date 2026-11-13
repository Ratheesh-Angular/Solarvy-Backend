import {
  CHATBOT_ASSESSMENT_SETTING_KEY,
  DEFAULT_CHATBOT_ASSESSMENT_SYSTEM_PROMPT,
} from "../config/chatbotDefaults.js";
import { getSetting } from "../repositories/appSettings.repository.js";
import {
  createDraft,
  getDraftById,
  updateDraft,
} from "../repositories/assessment.repository.js";
import { getCatalogs } from "./excelReader.service.js";
import { completeChatMessages } from "./openai.service.js";

const DEFAULT_GRID_TARIFF = "209.50";

export const EMPTY_ASSESSMENT_FORM = {
  propertyType: "",
  template: "",
  country: "",
  city: "",
  powerSetup: "",
  gridUnavailableBand: "",
  monthlyGeneratorFuelSpend: "",
  inputMethod: "bill",
  mainObjective: "",
  monthlyElectricityBill: "",
  bill: {
    fileName: "",
    notes: "",
    monthlyUsage: "",
    usageUnit: "kWh",
    monthlySpend: "",
    gridTariff: DEFAULT_GRID_TARIFF,
  },
  appliance: { rows: [] },
  custom: { rows: [] },
  roofArea: "",
  backupDuration: "",
};

function asObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) || {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

export function normalizeFormData(raw) {
  const src = asObject(raw);
  const bill = asObject(src.bill);
  const appliance = asObject(src.appliance);
  const custom = asObject(src.custom);
  return {
    ...EMPTY_ASSESSMENT_FORM,
    ...src,
    bill: { ...EMPTY_ASSESSMENT_FORM.bill, ...bill },
    appliance: {
      rows: Array.isArray(appliance.rows) ? appliance.rows : [],
    },
    custom: {
      rows: Array.isArray(custom.rows) ? custom.rows : [],
    },
    inputMethod:
      src.inputMethod === "appliance" || src.inputMethod === "custom"
        ? src.inputMethod
        : "bill",
  };
}

function pickFromList(value, list) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !Array.isArray(list) || !list.length) return null;
  const exact = list.find((item) => item === trimmed);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  const fuzzy = list.find((item) => String(item).toLowerCase() === lower);
  return fuzzy || null;
}

function toFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeLoadRows(rows, equipmentCatalog = []) {
  if (!Array.isArray(rows)) return null;
  const catalogByName = new Map(
    (equipmentCatalog || []).map((item) => [
      String(item.name || "").toLowerCase(),
      item,
    ]),
  );

  return rows
    .map((row, index) => {
      if (!row || typeof row !== "object") return null;
      const kind =
        typeof row.kind === "string"
          ? row.kind.trim()
          : typeof row.name === "string"
            ? row.name.trim()
            : "";
      if (!kind) return null;

      const catalog = catalogByName.get(kind.toLowerCase());
      let qty = toFiniteNumber(row.qty);
      let hours = toFiniteNumber(row.hours);
      let power = toFiniteNumber(row.power ?? row.watts);
      let loadFactorPct = toFiniteNumber(row.loadFactorPct);

      if (catalog) {
        if (power == null || power <= 0) power = Number(catalog.watts) || 0;
        if (hours == null || hours < 0) {
          hours = Number(catalog.hoursPerDay) || 0;
        }
        if (loadFactorPct == null) {
          const duty = Number(catalog.dutyCycle);
          loadFactorPct = Number.isFinite(duty)
            ? Math.round(duty <= 1 ? duty * 100 : duty)
            : 100;
        }
      }

      if (qty == null || qty < 0) qty = 1;
      if (hours == null || hours < 0) hours = "";
      if (power == null || power < 0) power = "";
      if (loadFactorPct == null || loadFactorPct < 0) loadFactorPct = 100;

      return {
        id:
          typeof row.id === "string" && row.id
            ? row.id
            : `chat-${Date.now()}-${index}`,
        kind,
        qty,
        hours,
        power,
        loadFactorPct,
        source: row.source === "template" ? "template" : "user",
        addedByUser: row.addedByUser !== false,
        excelRow: toFiniteNumber(row.excelRow) ?? undefined,
        removed: Boolean(row.removed),
      };
    })
    .filter(Boolean);
}

export function validateAndMergePatch(currentForm, patch, catalogs) {
  const next = normalizeFormData(currentForm);
  const src = asObject(patch);
  if (!Object.keys(src).length) return next;

  const propertyType = pickFromList(src.propertyType, catalogs.propertyTypes);
  if (propertyType) {
    next.propertyType = propertyType;
    const templates =
      catalogs.templatesByProperty?.[propertyType] ||
      Object.values(catalogs.templatesByProperty || {}).flat();
    const template = pickFromList(src.template, templates);
    if (template) next.template = template;
    else if (typeof src.template === "string" && src.template.trim()) {
      // keep previous template if new one invalid
    }
  } else if (typeof src.template === "string" && next.propertyType) {
    const templates =
      catalogs.templatesByProperty?.[next.propertyType] || [];
    const template = pickFromList(src.template, templates);
    if (template) next.template = template;
  }

  if (typeof src.country === "string" && src.country.trim()) {
    const country = pickFromList(src.country, catalogs.countries);
    next.country = country || src.country.trim();
  }
  if (typeof src.city === "string" && src.city.trim()) {
    const city = pickFromList(src.city, [
      ...(catalogs.states || []),
      ...(catalogs.cities || []),
    ]);
    next.city = city || src.city.trim();
  }

  const powerSetup = pickFromList(src.powerSetup, catalogs.powerSetups);
  if (powerSetup) next.powerSetup = powerSetup;

  const gridBand = pickFromList(
    src.gridUnavailableBand,
    catalogs.gridUnavailableBands,
  );
  if (gridBand) next.gridUnavailableBand = gridBand;

  if (
    typeof src.monthlyGeneratorFuelSpend === "string" ||
    typeof src.monthlyGeneratorFuelSpend === "number"
  ) {
    next.monthlyGeneratorFuelSpend = String(src.monthlyGeneratorFuelSpend).trim();
  }

  if (
    src.inputMethod === "bill" ||
    src.inputMethod === "appliance" ||
    src.inputMethod === "custom"
  ) {
    next.inputMethod = src.inputMethod;
  }

  const objective = pickFromList(src.mainObjective, catalogs.objectives);
  if (objective) next.mainObjective = objective;

  if (
    typeof src.monthlyElectricityBill === "string" ||
    typeof src.monthlyElectricityBill === "number"
  ) {
    next.monthlyElectricityBill = String(src.monthlyElectricityBill).trim();
  }

  if (typeof src.roofArea === "string" || typeof src.roofArea === "number") {
    next.roofArea = String(src.roofArea).trim();
  }

  const backup = pickFromList(src.backupDuration, catalogs.backupDurations);
  if (backup) next.backupDuration = backup;
  else if (typeof src.backupDuration === "string" && src.backupDuration.trim()) {
    next.backupDuration = src.backupDuration.trim();
  }

  if (src.bill && typeof src.bill === "object") {
    const bill = src.bill;
    if (bill.monthlyUsage != null) next.bill.monthlyUsage = String(bill.monthlyUsage).trim();
    if (bill.usageUnit != null) next.bill.usageUnit = String(bill.usageUnit).trim() || "kWh";
    if (bill.monthlySpend != null) {
      next.bill.monthlySpend = String(bill.monthlySpend).trim();
      if (!next.monthlyElectricityBill) {
        next.monthlyElectricityBill = next.bill.monthlySpend;
      }
    }
    if (bill.gridTariff != null) next.bill.gridTariff = String(bill.gridTariff).trim();
    if (bill.notes != null) next.bill.notes = String(bill.notes).trim();
  }

  if (src.appliance?.rows) {
    const rows = normalizeLoadRows(src.appliance.rows, catalogs.equipmentCatalog);
    if (rows) next.appliance = { rows };
  }
  if (src.custom?.rows) {
    const rows = normalizeLoadRows(src.custom.rows, catalogs.equipmentCatalog);
    if (rows) next.custom = { rows };
  }

  return next;
}

function rowIsUseful(row) {
  if (!row || row.removed) return false;
  const kind = String(row.kind || "").trim();
  if (!kind) return false;
  const qty = Number(row.qty);
  const power = Number(row.power);
  const hours = Number(row.hours);
  return (
    Number.isFinite(qty) &&
    qty > 0 &&
    Number.isFinite(power) &&
    power > 0 &&
    Number.isFinite(hours) &&
    hours >= 0
  );
}

export function getMissingFields(formData) {
  const form = normalizeFormData(formData);
  const missing = [];

  if (!form.propertyType) missing.push("propertyType");
  if (!form.template) missing.push("template");
  if (!form.powerSetup) missing.push("powerSetup");
  if (!form.gridUnavailableBand) missing.push("gridUnavailableBand");
  if (!form.mainObjective) missing.push("mainObjective");
  if (!form.country) missing.push("country");
  if (!form.city) missing.push("city");
  if (!form.backupDuration) missing.push("backupDuration");
  if (!form.inputMethod) missing.push("inputMethod");

  if (form.inputMethod === "bill") {
    const spend =
      form.bill?.monthlySpend ||
      form.monthlyElectricityBill ||
      form.bill?.monthlyUsage;
    if (!String(spend || "").trim()) missing.push("monthlyElectricityBill");
  } else if (form.inputMethod === "appliance") {
    const rows = (form.appliance?.rows || []).filter(rowIsUseful);
    if (!rows.length) missing.push("appliance.rows");
  } else if (form.inputMethod === "custom") {
    const rows = (form.custom?.rows || []).filter(rowIsUseful);
    if (!rows.length) missing.push("custom.rows");
  }

  return missing;
}

export function buildSuggestedReplies(missingFields, catalogs) {
  const next = missingFields[0];
  if (!next) {
    return ["Complete my assessment", "Review my answers"];
  }
  switch (next) {
    case "propertyType":
      return (catalogs.propertyTypes || []).slice(0, 4);
    case "template":
      return [];
    case "powerSetup":
      return (catalogs.powerSetups || []).slice(0, 4);
    case "gridUnavailableBand":
      return (catalogs.gridUnavailableBands || []).slice(0, 4);
    case "mainObjective":
      return (catalogs.objectives || []).slice(0, 4);
    case "backupDuration":
      return (catalogs.backupDurations || []).slice(0, 4);
    case "inputMethod":
      return ["Monthly bill", "Appliance list", "Custom equipment"];
    case "country":
      return (catalogs.countries || []).slice(0, 4);
    case "city":
      return (catalogs.states || catalogs.cities || []).slice(0, 4);
    default:
      return [];
  }
}

function catalogContext(catalogs) {
  const equipment = (catalogs.equipmentCatalog || [])
    .slice(0, 80)
    .map(
      (item) =>
        `${item.name} (${item.watts}W, ${item.hoursPerDay}h/day)`,
    )
    .join("; ");

  return [
    `Property types: ${(catalogs.propertyTypes || []).join(", ")}`,
    `Templates by property: ${JSON.stringify(catalogs.templatesByProperty || {})}`,
    `Power setups: ${(catalogs.powerSetups || []).join(", ")}`,
    `Grid unavailable bands: ${(catalogs.gridUnavailableBands || []).join(", ")}`,
    `Objectives: ${(catalogs.objectives || []).join(", ")}`,
    `Countries: ${(catalogs.countries || []).join(", ")}`,
    `States/cities: ${(catalogs.states || catalogs.cities || []).slice(0, 40).join(", ")}`,
    `Backup durations: ${(catalogs.backupDurations || []).join(", ")}`,
    `Equipment catalog (partial): ${equipment}`,
  ].join("\n");
}

async function resolveAssessmentPrompt() {
  const row = await getSetting(CHATBOT_ASSESSMENT_SETTING_KEY);
  const base = (row?.value || DEFAULT_CHATBOT_ASSESSMENT_SYSTEM_PROMPT).trim();
  return base || DEFAULT_CHATBOT_ASSESSMENT_SYSTEM_PROMPT;
}

function parseModelJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { reply: "", formPatch: {}, suggestedReplies: [] };
  }
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const parsed = JSON.parse(text);
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply.trim() : "",
      formPatch:
        parsed.formPatch && typeof parsed.formPatch === "object"
          ? parsed.formPatch
          : {},
      suggestedReplies: Array.isArray(parsed.suggestedReplies)
        ? parsed.suggestedReplies
            .filter((item) => typeof item === "string" && item.trim())
            .map((item) => item.trim())
            .slice(0, 6)
        : [],
    };
  } catch {
    return { reply: text, formPatch: {}, suggestedReplies: [] };
  }
}

export async function ensureAssessmentDraft({
  draftId,
  visitorId = null,
  sessionId = null,
  existingForm = null,
}) {
  const idNum = Number(draftId);
  if (Number.isInteger(idNum) && idNum > 0) {
    const existing = await getDraftById(idNum);
    if (existing) {
      return {
        id: existing.id,
        formData: normalizeFormData(existing.form_data ?? existing.formData),
      };
    }
  }

  if (existingForm) {
    const created = await createDraft(normalizeFormData(existingForm), {
      visitorId,
      sessionId,
    });
    return {
      id: created.id,
      formData: normalizeFormData(created.form_data),
    };
  }

  const created = await createDraft(EMPTY_ASSESSMENT_FORM, {
    visitorId,
    sessionId,
  });
  return {
    id: created.id,
    formData: normalizeFormData(created.form_data),
  };
}

/**
 * Run one assessment-mode chat turn: extract patch, merge draft, return UI hints.
 */
export async function runAssessmentChatTurn({
  userMessage,
  history,
  draftId,
  visitorId = null,
  visitorSessionId = null,
}) {
  const catalogs = await getCatalogs();
  const draft = await ensureAssessmentDraft({
    draftId,
    visitorId,
    sessionId: visitorSessionId,
  });

  const missingBefore = getMissingFields(draft.formData);
  const systemPrompt = await resolveAssessmentPrompt();

  const contextBlock = [
    "CURRENT DRAFT JSON:",
    JSON.stringify(draft.formData),
    "",
    `MISSING FIELDS (ask about the first ones next): ${missingBefore.join(", ") || "none — draft may be ready"}`,
    "",
    "ALLOWED CATALOG VALUES:",
    catalogContext(catalogs),
  ].join("\n");

  const messages = [
    { role: "system", content: `${systemPrompt}\n\n${contextBlock}` },
    ...history.map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
    })),
    { role: "user", content: userMessage },
  ];

  let raw;
  try {
    raw = await completeChatMessages({
      messages,
      timeoutMs: 45_000,
      jsonObject: true,
    });
  } catch (error) {
    console.error("Assessment chat OpenAI error:", error?.message || error);
    return {
      reply:
        "I'm having trouble updating your assessment right now. Please try again, or continue on the assessment form — your progress is saved as a draft.",
      draftId: draft.id,
      formData: draft.formData,
      missingFields: missingBefore,
      suggestedReplies: buildSuggestedReplies(missingBefore, catalogs),
      readyToComplete: missingBefore.length === 0,
    };
  }

  const parsed = parseModelJson(raw);
  const merged = validateAndMergePatch(
    draft.formData,
    parsed.formPatch,
    catalogs,
  );
  const updated = await updateDraft(draft.id, merged);
  const formData = normalizeFormData(updated.form_data);
  const missingFields = getMissingFields(formData);
  const suggestedReplies =
    parsed.suggestedReplies.length > 0
      ? parsed.suggestedReplies
      : buildSuggestedReplies(missingFields, catalogs);

  const reply =
    parsed.reply ||
    (missingFields.length
      ? `Thanks — I've updated your draft. Next I need: ${missingFields[0]}.`
      : "Your assessment draft looks complete. You can finish it to see results, or switch to the form to review.");

  return {
    reply,
    draftId: draft.id,
    formData,
    missingFields,
    suggestedReplies,
    readyToComplete: missingFields.length === 0,
  };
}
