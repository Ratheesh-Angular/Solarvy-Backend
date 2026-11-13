import {
  CHATBOT_SETTING_KEY,
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
} from "../config/chatbotDefaults.js";
import { getSetting } from "../repositories/appSettings.repository.js";
import {
  addChatMessage,
  createChatSession,
  getChatSession,
  listFaqs,
  listRecentChatMessages,
  touchChatSession,
  updateChatSession,
} from "../repositories/chatbot.repository.js";
import { runAssessmentChatTurn } from "./assessmentChat.service.js";
import { completeChatMessages } from "./openai.service.js";

export const CHAT_MESSAGE_MAX_LEN = 1000;
export const CHAT_HISTORY_LIMIT = 16;

const FALLBACK_REPLY =
  "I'm having trouble reaching Solarvy's AI assistant right now. Please try again in a moment, or explore How it works and Start assessment on the site.";

const rateBuckets = new Map();

function getClientKey(req) {
  const sessionHint =
    typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    "unknown";
  return `${ip}:${sessionHint || "new"}`;
}

function assertRateLimit(key, { limit = 20, windowMs = 60_000 } = {}) {
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const error = new Error(
      "You're sending messages too quickly. Please wait a moment and try again.",
    );
    error.status = 429;
    throw error;
  }

  if (rateBuckets.size > 5_000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.windowStart >= windowMs) rateBuckets.delete(k);
    }
  }
}

function validateMessage(raw) {
  if (typeof raw !== "string") {
    const error = new Error("Message is required");
    error.status = 400;
    throw error;
  }
  const message = raw.trim();
  if (!message) {
    const error = new Error("Message cannot be empty");
    error.status = 400;
    throw error;
  }
  if (message.length > CHAT_MESSAGE_MAX_LEN) {
    const error = new Error(
      `Message must be at most ${CHAT_MESSAGE_MAX_LEN} characters`,
    );
    error.status = 400;
    throw error;
  }
  if (/^(.)\1{20,}$/.test(message) || message.replace(/\s/g, "").length < 2) {
    const error = new Error(
      "Please ask a clearer question about Solarvy or solar energy.",
    );
    error.status = 400;
    throw error;
  }
  return message;
}

function isUuid(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function parseMode(raw) {
  return raw === "assessment" ? "assessment" : "faq";
}

function parseDraftId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function resolveSystemPrompt() {
  const row = await getSetting(CHATBOT_SETTING_KEY);
  const base = (row?.value || DEFAULT_CHATBOT_SYSTEM_PROMPT).trim();
  return base || DEFAULT_CHATBOT_SYSTEM_PROMPT;
}

function formatFaqContext(faqs) {
  if (!faqs.length) return "";
  const lines = faqs.map(
    (faq, index) =>
      `Q${index + 1}: ${faq.question.trim()}\nA${index + 1}: ${faq.answer.trim()}`,
  );
  return `\n\nFAQ CONTEXT (prefer these for matching questions):\n${lines.join("\n\n")}`;
}

async function ensureSession(sessionId, visitorId, { mode, draftId } = {}) {
  if (sessionId && isUuid(sessionId)) {
    const existing = await getChatSession(sessionId);
    if (existing) {
      const nextMode = mode || existing.mode || "faq";
      const nextDraft =
        draftId != null ? draftId : existing.draftId ?? null;
      if (
        nextMode !== existing.mode ||
        (draftId != null && draftId !== existing.draftId)
      ) {
        return (
          (await updateChatSession(existing.id, {
            mode: nextMode,
            draftId: nextDraft,
          })) || existing
        );
      }
      return existing;
    }
  }

  const safeVisitorId = isUuid(visitorId) ? visitorId : null;
  try {
    return await createChatSession({
      visitorId: safeVisitorId,
      draftId: draftId ?? null,
      mode: mode || "faq",
    });
  } catch (error) {
    if (safeVisitorId) {
      return createChatSession({
        visitorId: null,
        draftId: draftId ?? null,
        mode: mode || "faq",
      });
    }
    throw error;
  }
}

/**
 * Handle one user chat turn: validate, persist, call OpenAI with history + FAQ context.
 * When mode=assessment, collect form fields into a shared assessment draft.
 */
export async function handleChatTurn(req) {
  assertRateLimit(getClientKey(req));

  const message = validateMessage(req.body?.message);
  const mode = parseMode(req.body?.mode);
  const draftIdHint = parseDraftId(req.body?.draftId);
  const visitorId = req.headers["x-visitor-id"];
  const visitorSessionId = req.headers["x-session-id"];

  const session = await ensureSession(req.body?.sessionId, visitorId, {
    mode,
    draftId: draftIdHint,
  });

  await addChatMessage({
    sessionId: session.id,
    role: "user",
    content: message,
  });
  await touchChatSession(session.id);

  if (mode === "assessment") {
    const history = await listRecentChatMessages(
      session.id,
      CHAT_HISTORY_LIMIT,
    );
    // History already includes the user message just saved — strip trailing
    // duplicate when building the model prompt inside runAssessmentChatTurn.
    const historyForModel = history.slice(0, -1);

    const result = await runAssessmentChatTurn({
      userMessage: message,
      history: historyForModel,
      draftId: draftIdHint || session.draftId,
      visitorId: isUuid(visitorId) ? visitorId : null,
      visitorSessionId: isUuid(visitorSessionId) ? visitorSessionId : null,
    });

    await addChatMessage({
      sessionId: session.id,
      role: "assistant",
      content: result.reply,
    });
    await updateChatSession(session.id, {
      mode: "assessment",
      draftId: result.draftId,
    });

    return {
      sessionId: session.id,
      reply: result.reply,
      mode: "assessment",
      draftId: result.draftId,
      formData: result.formData,
      missingFields: result.missingFields,
      suggestedReplies: result.suggestedReplies,
      readyToComplete: result.readyToComplete,
    };
  }

  const [systemPrompt, faqs, history] = await Promise.all([
    resolveSystemPrompt(),
    listFaqs({ activeOnly: true }),
    listRecentChatMessages(session.id, CHAT_HISTORY_LIMIT),
  ]);

  const messages = [
    {
      role: "system",
      content: `${systemPrompt}${formatFaqContext(faqs)}`,
    },
    ...history.map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: row.content,
    })),
  ];

  let reply;
  try {
    reply = await completeChatMessages({
      messages,
      timeoutMs: 45_000,
    });
  } catch (error) {
    console.error("Chatbot OpenAI error:", error?.message || error);
    reply = FALLBACK_REPLY;
  }

  const safeReply =
    typeof reply === "string" && reply.trim()
      ? reply.trim()
      : FALLBACK_REPLY;

  await addChatMessage({
    sessionId: session.id,
    role: "assistant",
    content: safeReply,
  });
  await updateChatSession(session.id, { mode: "faq" });

  return {
    sessionId: session.id,
    reply: safeReply,
    mode: "faq",
  };
}
