import { randomUUID } from "crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || "").slice(0, 64);
}

export function getUserAgent(req) {
  return String(req.headers["user-agent"] || "").slice(0, 1000);
}

export function getVisitorIdFromRequest(req) {
  const header = req.headers["x-visitor-id"];
  const bodyId = req.body?.visitorId;
  const candidate =
    (typeof header === "string" && header) ||
    (typeof bodyId === "string" && bodyId) ||
    "";
  return isUuid(candidate) ? candidate.trim() : null;
}

export function getSessionIdFromRequest(req) {
  const header = req.headers["x-session-id"];
  const bodyId = req.body?.sessionId;
  const candidate =
    (typeof header === "string" && header) ||
    (typeof bodyId === "string" && bodyId) ||
    "";
  return isUuid(candidate) ? candidate.trim() : null;
}

export function newUuid() {
  return randomUUID();
}
