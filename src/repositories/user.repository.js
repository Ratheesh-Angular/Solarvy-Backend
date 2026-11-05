import { getPool } from "../config/database.js";
import { newUuid } from "../utils/requestMeta.js";

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phoneE164: row.phone_e164,
    authProvider: row.auth_provider,
    googleSub: row.google_sub,
    emailVerifiedAt: row.email_verified_at,
    country: row.country,
    region: row.region,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
    ipCountry: row.ip_country,
    ipRegion: row.ip_region,
    ipCity: row.ip_city,
    lastIp: row.last_ip,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function findUserByEmail(email) {
  const normalized = String(email || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const result = await getPool().query(
    `SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [normalized],
  );
  return mapUser(result.rows[0]);
}

export async function findUserById(id) {
  if (!id) return null;
  const result = await getPool().query(`SELECT * FROM users WHERE id = $1`, [
    id,
  ]);
  return mapUser(result.rows[0]);
}

export async function findUserByGoogleSub(googleSub) {
  if (!googleSub) return null;
  const result = await getPool().query(
    `SELECT * FROM users WHERE google_sub = $1 LIMIT 1`,
    [googleSub],
  );
  return mapUser(result.rows[0]);
}

export async function createUser({
  fullName,
  email,
  phoneE164,
  authProvider = "email",
  googleSub = null,
  emailVerifiedAt = null,
  country = "",
  region = "",
  city = "",
  latitude = null,
  longitude = null,
  ipCountry = "",
  ipRegion = "",
  ipCity = "",
  lastIp = "",
}) {
  const id = newUuid();
  const result = await getPool().query(
    `INSERT INTO users (
       id, full_name, email, phone_e164, auth_provider, google_sub,
       email_verified_at, country, region, city, latitude, longitude,
       ip_country, ip_region, ip_city, last_ip, last_login_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, NOW()
     )
     RETURNING *`,
    [
      id,
      String(fullName || "").trim(),
      String(email || "")
        .trim()
        .toLowerCase(),
      String(phoneE164 || "").trim(),
      authProvider,
      googleSub,
      emailVerifiedAt,
      country || "",
      region || "",
      city || "",
      latitude,
      longitude,
      ipCountry || "",
      ipRegion || "",
      ipCity || "",
      lastIp || "",
    ],
  );
  return mapUser(result.rows[0]);
}

export async function updateUserProfile(id, fields) {
  const result = await getPool().query(
    `UPDATE users SET
       full_name = COALESCE($2, full_name),
       phone_e164 = COALESCE($3, phone_e164),
       auth_provider = COALESCE($4, auth_provider),
       google_sub = COALESCE($5, google_sub),
       email_verified_at = COALESCE($6, email_verified_at),
       country = CASE WHEN $7 <> '' THEN $7 ELSE country END,
       region = CASE WHEN $8 <> '' THEN $8 ELSE region END,
       city = CASE WHEN $9 <> '' THEN $9 ELSE city END,
       latitude = COALESCE($10, latitude),
       longitude = COALESCE($11, longitude),
       ip_country = CASE WHEN $12 <> '' THEN $12 ELSE ip_country END,
       ip_region = CASE WHEN $13 <> '' THEN $13 ELSE ip_region END,
       ip_city = CASE WHEN $14 <> '' THEN $14 ELSE ip_city END,
       last_ip = CASE WHEN $15 <> '' THEN $15 ELSE last_ip END,
       last_login_at = NOW(),
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      fields.fullName ?? null,
      fields.phoneE164 ?? null,
      fields.authProvider ?? null,
      fields.googleSub ?? null,
      fields.emailVerifiedAt ?? null,
      fields.country || "",
      fields.region || "",
      fields.city || "",
      fields.latitude ?? null,
      fields.longitude ?? null,
      fields.ipCountry || "",
      fields.ipRegion || "",
      fields.ipCity || "",
      fields.lastIp || "",
    ],
  );
  return mapUser(result.rows[0]);
}

export async function touchUserLogin(id, { lastIp = "" } = {}) {
  const result = await getPool().query(
    `UPDATE users
     SET last_login_at = NOW(),
         last_ip = CASE WHEN $2 <> '' THEN $2 ELSE last_ip END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, lastIp],
  );
  return mapUser(result.rows[0]);
}

export function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    phoneE164: user.phoneE164,
    authProvider: user.authProvider,
  };
}
