import { getPool } from "../config/database.js";
import { isUuid, newUuid } from "../utils/requestMeta.js";

const SESSION_CONTINUE_MS = 30 * 60 * 1000;

export async function upsertVisitorAndSession({
  visitorId,
  sessionId,
  ip = "",
  userAgent = "",
  landingPath = "",
  referrer = "",
  city = "",
  region = "",
  country = "",
}) {
  const pool = getPool();
  const id = isUuid(visitorId) ? visitorId : newUuid();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingVisitor = await client.query(
      `SELECT id FROM visitors WHERE id = $1`,
      [id],
    );

    if (existingVisitor.rows[0]) {
      await client.query(
        `UPDATE visitors
         SET last_seen_at = NOW(),
             last_ip = $2,
             last_user_agent = $3,
             last_city = CASE
               WHEN $4 <> '' THEN $4
               ELSE last_city
             END,
             last_region = CASE
               WHEN $5 <> '' THEN $5
               ELSE last_region
             END,
             last_country = CASE
               WHEN $6 <> '' THEN $6
               ELSE last_country
             END
         WHERE id = $1`,
        [id, ip, userAgent, city || "", region || "", country || ""],
      );
    } else {
      await client.query(
        `INSERT INTO visitors (
           id, user_number, first_seen_at, last_seen_at, last_ip, last_user_agent,
           last_city, last_region, last_country
         ) VALUES (
           $1,
           nextval('visitors_user_number_seq'),
           NOW(), NOW(), $2, $3, $4, $5, $6
         )`,
        [id, ip, userAgent, city || "", region || "", country || ""],
      );
    }

    let activeSessionId = null;

    if (isUuid(sessionId)) {
      const existing = await client.query(
        `SELECT id, visitor_id, last_seen_at
         FROM visitor_sessions
         WHERE id = $1`,
        [sessionId],
      );
      const row = existing.rows[0];
      if (row && row.visitor_id === id) {
        await client.query(
          `UPDATE visitor_sessions
           SET last_seen_at = NOW(),
               ip = $2,
               user_agent = $3
           WHERE id = $1`,
          [row.id, ip, userAgent],
        );
        activeSessionId = row.id;
      }
    }

    if (!activeSessionId) {
      const recent = await client.query(
        `SELECT id, last_seen_at
         FROM visitor_sessions
         WHERE visitor_id = $1
         ORDER BY last_seen_at DESC
         LIMIT 1`,
        [id],
      );
      const last = recent.rows[0];
      if (
        last &&
        Date.now() - new Date(last.last_seen_at).getTime() < SESSION_CONTINUE_MS
      ) {
        await client.query(
          `UPDATE visitor_sessions
           SET last_seen_at = NOW(),
               ip = $2,
               user_agent = $3
           WHERE id = $1`,
          [last.id, ip, userAgent],
        );
        activeSessionId = last.id;
      }
    }

    if (!activeSessionId) {
      activeSessionId = newUuid();
      await client.query(
        `INSERT INTO visitor_sessions (
           id, visitor_id, started_at, last_seen_at, ip, user_agent, landing_path, referrer
         ) VALUES ($1, $2, NOW(), NOW(), $3, $4, $5, $6)`,
        [
          activeSessionId,
          id,
          ip,
          userAgent,
          String(landingPath || "").slice(0, 500),
          String(referrer || "").slice(0, 500),
        ],
      );
    }

    await client.query("COMMIT");
    return { visitorId: id, sessionId: activeSessionId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function touchVisitor(visitorId, { ip = "", userAgent = "" } = {}) {
  if (!isUuid(visitorId)) return;
  await getPool().query(
    `UPDATE visitors
     SET last_seen_at = NOW(),
         last_ip = CASE WHEN $2 <> '' THEN $2 ELSE last_ip END,
         last_user_agent = CASE WHEN $3 <> '' THEN $3 ELSE last_user_agent END
     WHERE id = $1`,
    [visitorId, ip, userAgent],
  );
}

export async function ensureVisitorExists(visitorId) {
  if (!isUuid(visitorId)) return null;
  const result = await getPool().query(
    `SELECT id FROM visitors WHERE id = $1`,
    [visitorId],
  );
  return result.rows[0]?.id ?? null;
}
