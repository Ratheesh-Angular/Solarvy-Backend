import { getPool } from "../config/database.js";

export async function countAdminUsers() {
  const result = await getPool().query(
    "SELECT COUNT(*)::int AS count FROM admin_users",
  );
  return result.rows[0]?.count ?? 0;
}

export async function findAdminByUsername(username) {
  const result = await getPool().query(
    "SELECT id, username, password_hash, created_at FROM admin_users WHERE username = $1 LIMIT 1",
    [username],
  );
  return result.rows[0] ?? null;
}

export async function findAdminById(id) {
  const result = await getPool().query(
    "SELECT id, username, created_at FROM admin_users WHERE id = $1 LIMIT 1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createAdminUser(username, passwordHash) {
  const result = await getPool().query(
    `INSERT INTO admin_users (username, password_hash)
     VALUES ($1, $2)
     RETURNING id, username, created_at`,
    [username, passwordHash],
  );
  return result.rows[0];
}

export async function updateAdminPasswordHash(id, passwordHash) {
  await getPool().query(
    "UPDATE admin_users SET password_hash = $2 WHERE id = $1",
    [id, passwordHash],
  );
}
