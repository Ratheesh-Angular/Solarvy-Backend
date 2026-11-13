import { randomUUID } from "crypto";
import { getPool } from "../config/database.js";

const SESSION_SELECT = `id, visitor_id AS "visitorId", draft_id AS "draftId", mode,
            created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function createChatSession({
  visitorId = null,
  draftId = null,
  mode = "faq",
} = {}) {
  const id = randomUUID();
  const safeMode = mode === "assessment" ? "assessment" : "faq";
  const result = await getPool().query(
    `INSERT INTO chat_sessions (id, visitor_id, draft_id, mode, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING ${SESSION_SELECT}`,
    [id, visitorId, draftId, safeMode],
  );
  return result.rows[0];
}

export async function getChatSession(sessionId) {
  const result = await getPool().query(
    `SELECT ${SESSION_SELECT}
     FROM chat_sessions
     WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

export async function touchChatSession(sessionId) {
  await getPool().query(
    `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

export async function updateChatSession(
  sessionId,
  { draftId, mode } = {},
) {
  const result = await getPool().query(
    `UPDATE chat_sessions
     SET draft_id = COALESCE($2, draft_id),
         mode = COALESCE($3, mode),
         updated_at = NOW()
     WHERE id = $1
     RETURNING ${SESSION_SELECT}`,
    [
      sessionId,
      draftId === undefined ? null : draftId,
      mode === undefined
        ? null
        : mode === "assessment"
          ? "assessment"
          : "faq",
    ],
  );
  return result.rows[0] || null;
}

export async function addChatMessage({ sessionId, role, content }) {
  const result = await getPool().query(
    `INSERT INTO chat_messages (session_id, role, content, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id, session_id AS "sessionId", role, content, created_at AS "createdAt"`,
    [sessionId, role, content],
  );
  return result.rows[0];
}

export async function listRecentChatMessages(sessionId, limit = 20) {
  const result = await getPool().query(
    `SELECT id, session_id AS "sessionId", role, content, created_at AS "createdAt"
     FROM (
       SELECT id, session_id, role, content, created_at
       FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC`,
    [sessionId, limit],
  );
  return result.rows;
}

export async function listChatSessions({
  mode = null,
  limit = 50,
  offset = 0,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const params = [];
  let where = "";
  if (mode === "faq" || mode === "assessment") {
    params.push(mode);
    where = `WHERE s.mode = $${params.length}`;
  }
  params.push(safeLimit, safeOffset);

  const result = await getPool().query(
    `SELECT s.id,
            s.visitor_id AS "visitorId",
            s.draft_id AS "draftId",
            s.mode,
            s.created_at AS "createdAt",
            s.updated_at AS "updatedAt",
            COALESCE(m.msg_count, 0)::int AS "messageCount"
     FROM chat_sessions s
     LEFT JOIN (
       SELECT session_id, COUNT(*)::int AS msg_count
       FROM chat_messages
       GROUP BY session_id
     ) m ON m.session_id = s.id
     ${where}
     ORDER BY s.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return result.rows;
}

export async function countChatSessions({ mode = null } = {}) {
  if (mode === "faq" || mode === "assessment") {
    const result = await getPool().query(
      `SELECT COUNT(*)::int AS count FROM chat_sessions WHERE mode = $1`,
      [mode],
    );
    return result.rows[0]?.count ?? 0;
  }
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM chat_sessions`,
  );
  return result.rows[0]?.count ?? 0;
}

export async function getChatSessionDetail(sessionId) {
  const session = await getChatSession(sessionId);
  if (!session) return null;

  const messages = await getPool().query(
    `SELECT id, session_id AS "sessionId", role, content, created_at AS "createdAt"
     FROM chat_messages
     WHERE session_id = $1
     ORDER BY created_at ASC`,
    [sessionId],
  );

  return { ...session, messages: messages.rows };
}

export async function getChatAnalyticsSummary() {
  const result = await getPool().query(
    `SELECT
       (SELECT COUNT(*)::int FROM chat_sessions) AS "totalSessions",
       (SELECT COUNT(*)::int FROM chat_messages) AS "totalMessages",
       (SELECT COUNT(*)::int FROM chat_sessions WHERE mode = 'assessment') AS "assessmentSessions",
       (SELECT COUNT(*)::int FROM chat_sessions WHERE draft_id IS NOT NULL) AS "sessionsWithDraft",
       (SELECT COUNT(*)::int FROM chat_sessions WHERE mode = 'faq') AS "faqSessions"`,
  );
  return (
    result.rows[0] || {
      totalSessions: 0,
      totalMessages: 0,
      assessmentSessions: 0,
      sessionsWithDraft: 0,
      faqSessions: 0,
    }
  );
}

export async function listFaqs({ activeOnly = false } = {}) {
  const result = await getPool().query(
    `SELECT id, question, answer, sort_order AS "sortOrder",
            is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM faq_entries
     ${activeOnly ? "WHERE is_active = TRUE" : ""}
     ORDER BY sort_order ASC, id ASC`,
  );
  return result.rows;
}

export async function getFaqById(id) {
  const result = await getPool().query(
    `SELECT id, question, answer, sort_order AS "sortOrder",
            is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM faq_entries
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function createFaq({ question, answer, sortOrder = 0, isActive = true }) {
  const result = await getPool().query(
    `INSERT INTO faq_entries (question, answer, sort_order, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id, question, answer, sort_order AS "sortOrder",
               is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [question, answer, sortOrder, isActive],
  );
  return result.rows[0];
}

export async function updateFaq(id, { question, answer, sortOrder, isActive }) {
  const result = await getPool().query(
    `UPDATE faq_entries
     SET question = COALESCE($2, question),
         answer = COALESCE($3, answer),
         sort_order = COALESCE($4, sort_order),
         is_active = COALESCE($5, is_active),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, question, answer, sort_order AS "sortOrder",
               is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, question ?? null, answer ?? null, sortOrder ?? null, isActive ?? null],
  );
  return result.rows[0] || null;
}

export async function deleteFaq(id) {
  const result = await getPool().query(
    `DELETE FROM faq_entries WHERE id = $1
     RETURNING id`,
    [id],
  );
  return result.rows[0] || null;
}

export async function countFaqs() {
  const result = await getPool().query(`SELECT COUNT(*)::int AS count FROM faq_entries`);
  return result.rows[0]?.count ?? 0;
}
