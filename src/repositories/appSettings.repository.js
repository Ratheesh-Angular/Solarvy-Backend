import { getPool } from "../config/database.js";

export async function getSetting(key) {
  const result = await getPool().query(
    `SELECT key, value, updated_at AS "updatedAt"
     FROM app_settings
     WHERE key = $1`,
    [key],
  );
  return result.rows[0] || null;
}

export async function upsertSetting(key, value) {
  const result = await getPool().query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW()
     RETURNING key, value, updated_at AS "updatedAt"`,
    [key, value],
  );
  return result.rows[0];
}
