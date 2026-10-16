import { getPool } from "../config/database.js";
import { isUuid } from "../utils/requestMeta.js";

const ALLOWED_EVENT_TYPES = new Set([
  "page_view",
  "page_leave",
  "assessment_started",
  "assessment_completed",
  "request_intro_submitted",
  "expert_review_submitted",
  "quote_upload_submitted",
  "contact_submitted",
  "results_viewed",
  "pdf_download",
  "matched_installers_viewed",
  "cta_click",
]);

export function normalizeEventType(value) {
  const type = String(value || "").trim();
  return ALLOWED_EVENT_TYPES.has(type) ? type : null;
}

export async function createActivityEvent({
  visitorId = null,
  sessionId = null,
  eventType,
  path = "",
  entityType = "",
  entityId = "",
  metadata = {},
  ip = "",
  userAgent = "",
}) {
  const type = normalizeEventType(eventType);
  if (!type) {
    throw new Error("Invalid event type");
  }

  const result = await getPool().query(
    `INSERT INTO activity_events (
       visitor_id, session_id, event_type, path, entity_type, entity_id,
       metadata, ip, user_agent
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, created_at`,
    [
      isUuid(visitorId) ? visitorId : null,
      isUuid(sessionId) ? sessionId : null,
      type,
      String(path || "").slice(0, 500),
      String(entityType || "").slice(0, 80),
      String(entityId || "").slice(0, 80),
      JSON.stringify(metadata && typeof metadata === "object" ? metadata : {}),
      String(ip || "").slice(0, 64),
      String(userAgent || "").slice(0, 1000),
    ],
  );

  return result.rows[0];
}

export async function createActivityEvents(events) {
  const created = [];
  for (const event of events) {
    created.push(await createActivityEvent(event));
  }
  return created;
}
