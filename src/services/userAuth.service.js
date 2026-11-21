import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import {
  createEmailOtp,
  consumeOtp,
  countRecentOtps,
  findLatestActiveOtp,
  incrementOtpAttempts,
  invalidateActiveOtps,
} from "../repositories/emailOtp.repository.js";
import {
  createUser,
  findUserByEmail,
  findUserByGoogleSub,
  findUserById,
  setUserAvatar,
  toPublicUser,
  touchUserLogin,
  updateAccountProfile,
  updateUserProfile,
} from "../repositories/user.repository.js";
import { sendOtpEmail } from "./email.service.js";
import { lookupIpGeolocation } from "./ipGeolocation.service.js";
import {
  deleteStoredFile,
  saveAvatar,
} from "./fileStorage.service.js";
import { isValidEmail, normalizeNigeriaPhone } from "../utils/phone.js";
import {
  getClientIp,
  getVisitorIdFromRequest,
  isUuid,
} from "../utils/requestMeta.js";
import { upsertVisitorAndSession } from "../repositories/visitor.repository.js";
import { getPool } from "../config/database.js";
import { getServerConfig, isProduction } from "../config/env.js";

const USER_TOKEN_EXPIRY = "30d";
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RATE_LIMIT = 5;

function getUserJwtSecret() {
  const secret =
    process.env.USER_JWT_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return secret;
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 1000000));
}

async function hashOtp(code) {
  return bcrypt.hash(code, 10);
}

async function verifyOtpHash(code, hash) {
  return bcrypt.compare(code, hash);
}

async function linkVisitorToUser(req, userId) {
  const visitorId = getVisitorIdFromRequest(req);
  if (!visitorId || !isUuid(userId)) return;

  const geo = await geoForRequest(req);
  await upsertVisitorAndSession({
    visitorId,
    sessionId: null,
    ip: geo.ip,
    userAgent: String(req.headers["user-agent"] || ""),
    city: geo.city || "",
    region: geo.region || "",
    country: geo.country || "",
  });

  await getPool().query(
    `UPDATE visitors
     SET user_id = $2,
         last_seen_at = NOW()
     WHERE id = $1`,
    [visitorId, userId],
  );
}

function apiOriginFromReq(req) {
  const { apiUrl } = getServerConfig();
  // In development, prefer relative URLs so local uploads are served via the
  // Vite /api proxy instead of a production API_URL in Backend/.env.
  if (!isProduction()) {
    return "";
  }
  if (apiUrl) return apiUrl.replace(/\/$/, "");
  if (!req) return "";
  return `${req.protocol}://${req.get("host")}`;
}

function publicUser(user, req) {
  return toPublicUser(user, { apiOrigin: apiOriginFromReq(req) });
}

function issueUserToken(user, req) {
  const token = jwt.sign(
    { sub: user.id, email: user.email, typ: "user" },
    getUserJwtSecret(),
    { expiresIn: USER_TOKEN_EXPIRY },
  );
  return {
    token,
    user: publicUser(user, req),
  };
}

async function geoForRequest(req) {
  const ip = getClientIp(req);
  const geo = await lookupIpGeolocation(ip);
  return { ip, ...geo };
}

export async function requestSignupOtp(req, { fullName, phoneE164, email }) {
  const name = String(fullName || "").trim();
  const phone = normalizeNigeriaPhone(phoneE164);
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!name) {
    const err = new Error("Full name is required");
    err.status = 400;
    throw err;
  }
  if (!phone) {
    const err = new Error("Enter a valid Nigeria phone number");
    err.status = 400;
    throw err;
  }
  if (!isValidEmail(normalizedEmail)) {
    const err = new Error("Enter a valid email address");
    err.status = 400;
    throw err;
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    const err = new Error(
      "An account with this email already exists. Please log in instead.",
    );
    err.status = 409;
    throw err;
  }

  const recent = await countRecentOtps({
    email: normalizedEmail,
    purpose: "signup",
    sinceMinutes: 15,
  });
  if (recent >= OTP_RATE_LIMIT) {
    const err = new Error(
      "Too many verification emails. Please wait a few minutes and try again.",
    );
    err.status = 429;
    throw err;
  }

  const geo = await geoForRequest(req);
  const code = generateOtpCode();
  const codeHash = await hashOtp(code);
  await invalidateActiveOtps(normalizedEmail, "signup");
  await createEmailOtp({
    email: normalizedEmail,
    purpose: "signup",
    codeHash,
    payload: {
      fullName: name,
      phoneE164: phone,
      ...geo,
    },
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await sendOtpEmail({ to: normalizedEmail, code, purpose: "signup" });
  return { email: normalizedEmail };
}

export async function verifySignupOtp(req, { email, code }) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const otpCode = String(code || "").trim();

  if (!isValidEmail(normalizedEmail) || !/^\d{6}$/.test(otpCode)) {
    const err = new Error("Invalid email or verification code");
    err.status = 400;
    throw err;
  }

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    const err = new Error("An account with this email already exists");
    err.status = 409;
    throw err;
  }

  const otp = await findLatestActiveOtp(normalizedEmail, "signup");
  if (!otp) {
    const err = new Error("Verification code expired or not found. Request a new one.");
    err.status = 400;
    throw err;
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await consumeOtp(otp.id);
    const err = new Error("Too many incorrect attempts. Request a new code.");
    err.status = 400;
    throw err;
  }

  const valid = await verifyOtpHash(otpCode, otp.code_hash);
  if (!valid) {
    await incrementOtpAttempts(otp.id);
    const err = new Error("Incorrect verification code");
    err.status = 400;
    throw err;
  }

  await consumeOtp(otp.id);
  const payload = otp.payload || {};
  const user = await createUser({
    fullName: payload.fullName || "",
    email: normalizedEmail,
    phoneE164: payload.phoneE164 || "",
    authProvider: "email",
    emailVerifiedAt: new Date(),
    country: payload.country || "",
    region: payload.region || "",
    city: payload.city || "",
    latitude: payload.latitude ?? null,
    longitude: payload.longitude ?? null,
    ipCountry: payload.ipCountry || "",
    ipRegion: payload.ipRegion || "",
    ipCity: payload.ipCity || "",
    lastIp: payload.ip || "",
  });

  await linkVisitorToUser(req, user.id);
  return issueUserToken(user, req);
}

export async function requestLoginOtp(req, { email }) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  if (!isValidEmail(normalizedEmail)) {
    const err = new Error("Enter a valid email address");
    err.status = 400;
    throw err;
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user || !user.emailVerifiedAt) {
    const err = new Error(
      "No account found for this email. Please sign up first.",
    );
    err.status = 404;
    throw err;
  }

  const recent = await countRecentOtps({
    email: normalizedEmail,
    purpose: "login",
    sinceMinutes: 15,
  });
  if (recent >= OTP_RATE_LIMIT) {
    const err = new Error(
      "Too many login emails. Please wait a few minutes and try again.",
    );
    err.status = 429;
    throw err;
  }

  const code = generateOtpCode();
  const codeHash = await hashOtp(code);
  await invalidateActiveOtps(normalizedEmail, "login");
  await createEmailOtp({
    email: normalizedEmail,
    purpose: "login",
    codeHash,
    payload: {},
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  await sendOtpEmail({ to: normalizedEmail, code, purpose: "login" });
  return { email: normalizedEmail };
}

export async function verifyLoginOtp(req, { email, code }) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  const otpCode = String(code || "").trim();

  if (!isValidEmail(normalizedEmail) || !/^\d{6}$/.test(otpCode)) {
    const err = new Error("Invalid email or login code");
    err.status = 400;
    throw err;
  }

  const user = await findUserByEmail(normalizedEmail);
  if (!user) {
    const err = new Error("No account found for this email");
    err.status = 404;
    throw err;
  }

  const otp = await findLatestActiveOtp(normalizedEmail, "login");
  if (!otp) {
    const err = new Error("Login code expired or not found. Request a new one.");
    err.status = 400;
    throw err;
  }

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await consumeOtp(otp.id);
    const err = new Error("Too many incorrect attempts. Request a new code.");
    err.status = 400;
    throw err;
  }

  const valid = await verifyOtpHash(otpCode, otp.code_hash);
  if (!valid) {
    await incrementOtpAttempts(otp.id);
    const err = new Error("Incorrect login code");
    err.status = 400;
    throw err;
  }

  await consumeOtp(otp.id);
  const geo = await geoForRequest(req);
  const updated = await touchUserLogin(user.id, {
    lastIp: geo.ip,
    ipCountry: geo.ipCountry || "",
    ipRegion: geo.ipRegion || "",
    ipCity: geo.ipCity || "",
  });
  await linkVisitorToUser(req, user.id);
  return issueUserToken(updated || user, req);
}

async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    const err = new Error("Google sign-in is not configured on the server");
    err.status = 503;
    throw err;
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!response.ok) {
    const err = new Error("Invalid Google token");
    err.status = 401;
    throw err;
  }

  const payload = await response.json();
  if (payload.aud !== clientId) {
    const err = new Error("Google token audience mismatch");
    err.status = 401;
    throw err;
  }
  if (payload.email_verified !== "true" && payload.email_verified !== true) {
    const err = new Error("Google email is not verified");
    err.status = 401;
    throw err;
  }

  return {
    sub: payload.sub,
    email: String(payload.email || "")
      .trim()
      .toLowerCase(),
    name: String(payload.name || "").trim(),
  };
}

export async function authenticateWithGoogle(
  req,
  { idToken, fullName, phoneE164 },
) {
  if (!idToken) {
    const err = new Error("Google token is required");
    err.status = 400;
    throw err;
  }

  const google = await verifyGoogleIdToken(idToken);
  const geo = await geoForRequest(req);

  let user =
    (await findUserByGoogleSub(google.sub)) ||
    (await findUserByEmail(google.email));

  if (user) {
    const nextProvider =
      user.authProvider === "email" || user.authProvider === "both"
        ? "both"
        : "google";

    const phone =
      normalizeNigeriaPhone(phoneE164) || user.phoneE164 || "";
    const name = String(fullName || "").trim() || user.fullName || google.name;

    if (!phone) {
      const err = new Error(
        "Please provide your full name and Nigeria phone number to continue with Google.",
      );
      err.status = 400;
      err.code = "PROFILE_REQUIRED";
      throw err;
    }

    user = await updateUserProfile(user.id, {
      fullName: name,
      phoneE164: phone,
      authProvider: nextProvider,
      googleSub: google.sub,
      emailVerifiedAt: user.emailVerifiedAt || new Date(),
      country: geo.country,
      region: geo.region,
      city: geo.city,
      latitude: geo.latitude,
      longitude: geo.longitude,
      ipCountry: geo.ipCountry,
      ipRegion: geo.ipRegion,
      ipCity: geo.ipCity,
      lastIp: geo.ip,
    });
  } else {
    const phone = normalizeNigeriaPhone(phoneE164);
    const name = String(fullName || "").trim() || google.name;
    if (!name || !phone) {
      const err = new Error(
        "Please provide your full name and Nigeria phone number to continue with Google.",
      );
      err.status = 400;
      err.code = "PROFILE_REQUIRED";
      throw err;
    }

    user = await createUser({
      fullName: name,
      email: google.email,
      phoneE164: phone,
      authProvider: "google",
      googleSub: google.sub,
      emailVerifiedAt: new Date(),
      country: geo.country,
      region: geo.region,
      city: geo.city,
      latitude: geo.latitude,
      longitude: geo.longitude,
      ipCountry: geo.ipCountry,
      ipRegion: geo.ipRegion,
      ipCity: geo.ipCity,
      lastIp: geo.ip,
    });
  }

  await linkVisitorToUser(req, user.id);
  return issueUserToken(user, req);
}

export async function verifyUserToken(token, req) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getUserJwtSecret());
    if (payload.typ && payload.typ !== "user") return null;
    const user = await findUserById(payload.sub);
    return user ? publicUser(user, req) : null;
  } catch {
    return null;
  }
}

export async function updateCurrentUserProfile(
  req,
  { fullName, phoneE164, country, region, city },
) {
  const token = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const current = await verifyUserToken(token, req);
  if (!current) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const name = String(fullName || "").trim();
  if (!name) {
    const err = new Error("Full name is required");
    err.status = 400;
    throw err;
  }

  const phone = normalizeNigeriaPhone(phoneE164);
  if (!phone) {
    const err = new Error("Enter a valid Nigeria phone number");
    err.status = 400;
    throw err;
  }

  const updated = await updateAccountProfile(current.id, {
    fullName: name,
    phoneE164: phone,
    country: String(country || "").trim(),
    region: String(region || "").trim(),
    city: String(city || "").trim(),
  });

  return publicUser(updated, req);
}

export async function uploadCurrentUserAvatar(req, file) {
  const token = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const current = await verifyUserToken(token, req);
  if (!current) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const existing = await findUserById(current.id);
  const saved = await saveAvatar(file);

  if (existing?.avatarUrl && !/^https?:\/\//i.test(existing.avatarUrl)) {
    await deleteStoredFile(existing.avatarUrl);
  }

  const updated = await setUserAvatar(current.id, saved.storagePath);
  return publicUser(updated, req);
}

export async function deleteCurrentUserAvatar(req) {
  const token = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  const current = await verifyUserToken(token, req);
  if (!current) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  const existing = await findUserById(current.id);
  if (existing?.avatarUrl && !/^https?:\/\//i.test(existing.avatarUrl)) {
    await deleteStoredFile(existing.avatarUrl);
  }

  const updated = await setUserAvatar(current.id, "");
  return publicUser(updated, req);
}
