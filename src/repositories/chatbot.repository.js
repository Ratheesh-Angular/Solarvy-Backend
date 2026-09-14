import { randomUUID } from "crypto";
import { getPool } from "../config/database.js";

export async function createChatSession({ visitorId = null } = {}) {
  const id = randomUUID();
  const result = await getPool().query(
    `INSERT INTO chat_sessions (id, visitor_id, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     RETURNING id, visitor_id AS "visitorId", created_at AS "createdAt", updated_at AS "updatedAt"`,
    [id, visitorId],
  );
  return result.rows[0];
}

export async function getChatSession(sessionId) {
  const result = await getPool().query(
    `SELECT id, visitor_id AS "visitorId", created_at AS "createdAt", updated_at AS "updatedAt"
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
