import { getPool } from "../config/database.js";
import { parsePermissions } from "../config/adminPermissions.js";

function mapAdminRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email ?? null,
    password_hash: row.password_hash,
    is_super_admin: Boolean(row.is_super_admin),
    permissions: parsePermissions(row.permissions),
    created_at: row.created_at,
  };
}

const ADMIN_SELECT = `
  id, username, email, password_hash, is_super_admin, permissions, created_at
`;

export async function countAdminUsers() {
  const result = await getPool().query(
    "SELECT COUNT(*)::int AS count FROM admin_users",
  );
  return result.rows[0]?.count ?? 0;
}

export async function findAdminByUsername(username) {
  const result = await getPool().query(
    `SELECT ${ADMIN_SELECT} FROM admin_users WHERE username = $1 LIMIT 1`,
    [username],
  );
  return mapAdminRow(result.rows[0]);
}

export async function findAdminByEmail(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const result = await getPool().query(
    `SELECT ${ADMIN_SELECT}
     FROM admin_users
     WHERE email IS NOT NULL AND LOWER(email) = $1
     LIMIT 1`,
    [normalized],
  );
  return mapAdminRow(result.rows[0]);
}

export async function findAdminByLogin(identifier) {
  const normalized = String(identifier || "").trim();
  if (!normalized) return null;

  if (normalized.includes("@")) {
    const byEmail = await findAdminByEmail(normalized);
    if (byEmail) return byEmail;
  }

  return findAdminByUsername(normalized);
}

export async function findAdminById(id) {
  const result = await getPool().query(
    `SELECT ${ADMIN_SELECT} FROM admin_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return mapAdminRow(result.rows[0]);
}

export async function createAdminUser(username, passwordHash) {
  const result = await getPool().query(
    `INSERT INTO admin_users (username, password_hash, is_super_admin, permissions)
     VALUES ($1, $2, false, '[]'::jsonb)
     RETURNING ${ADMIN_SELECT}`,
    [username, passwordHash],
  );
  return mapAdminRow(result.rows[0]);
}

export async function updateAdminPasswordHash(id, passwordHash) {
  await getPool().query(
    "UPDATE admin_users SET password_hash = $2 WHERE id = $1",
    [id, passwordHash],
  );
}

export async function markAdminAsSuperAdmin(id) {
  await getPool().query(
    `UPDATE admin_users
     SET is_super_admin = true,
         permissions = '[]'::jsonb
     WHERE id = $1`,
    [id],
  );
}

export async function listStaffAdminUsers() {
  const result = await getPool().query(
    `SELECT ${ADMIN_SELECT}
     FROM admin_users
     WHERE is_super_admin = false
     ORDER BY created_at DESC, id DESC`,
  );
  return result.rows.map(mapAdminRow);
}

export async function createStaffAdminUser({
  username,
  email,
  passwordHash,
  permissions,
}) {
  const result = await getPool().query(
    `INSERT INTO admin_users (
       username, email, password_hash, is_super_admin, permissions
     )
     VALUES ($1, $2, $3, false, $4::jsonb)
     RETURNING ${ADMIN_SELECT}`,
    [username, email, passwordHash, JSON.stringify(permissions)],
  );
  return mapAdminRow(result.rows[0]);
}

export async function updateStaffAdminUser(id, { email, username, permissions }) {
  const result = await getPool().query(
    `UPDATE admin_users
     SET email = $2,
         username = $3,
         permissions = $4::jsonb
     WHERE id = $1 AND is_super_admin = false
     RETURNING ${ADMIN_SELECT}`,
    [id, email, username, JSON.stringify(permissions)],
  );
  return mapAdminRow(result.rows[0]);
}

export async function updateStaffAdminPassword(id, passwordHash) {
  const result = await getPool().query(
    `UPDATE admin_users
     SET password_hash = $2
     WHERE id = $1 AND is_super_admin = false
     RETURNING id`,
    [id, passwordHash],
  );
  return result.rows[0] ?? null;
}

export async function deleteStaffAdminUser(id) {
  const result = await getPool().query(
    `DELETE FROM admin_users
     WHERE id = $1 AND is_super_admin = false
     RETURNING id`,
    [id],
  );
  return result.rows[0] ?? null;
}
