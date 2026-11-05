import { getPool } from "../config/database.js";

export async function createEmailOtp({
  email,
  purpose,
  codeHash,
  payload = {},
  expiresAt,
}) {
  const result = await getPool().query(
    `INSERT INTO email_otps (email, purpose, code_hash, payload, expires_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [
      String(email || "")
        .trim()
        .toLowerCase(),
      purpose,
      codeHash,
      JSON.stringify(payload || {}),
      expiresAt,
    ],
  );
  return result.rows[0];
}

export async function findLatestActiveOtp(email, purpose) {
  const result = await getPool().query(
    `SELECT * FROM email_otps
     WHERE LOWER(email) = LOWER($1)
       AND purpose = $2
       AND consumed_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [String(email || "").trim(), purpose],
  );
  return result.rows[0] || null;
}

export async function incrementOtpAttempts(id) {
  await getPool().query(
    `UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1`,
    [id],
  );
}

export async function consumeOtp(id) {
  await getPool().query(
    `UPDATE email_otps SET consumed_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function countRecentOtps({ email, purpose, sinceMinutes = 15 }) {
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS count
     FROM email_otps
     WHERE LOWER(email) = LOWER($1)
       AND purpose = $2
       AND created_at > NOW() - ($3 || ' minutes')::interval`,
    [String(email || "").trim(), purpose, String(sinceMinutes)],
  );
  return result.rows[0]?.count ?? 0;
}

export async function invalidateActiveOtps(email, purpose) {
  await getPool().query(
    `UPDATE email_otps
     SET consumed_at = NOW()
     WHERE LOWER(email) = LOWER($1)
       AND purpose = $2
       AND consumed_at IS NULL`,
    [String(email || "").trim(), purpose],
  );
}
