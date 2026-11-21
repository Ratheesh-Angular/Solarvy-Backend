import { getPool } from "../config/database.js";
import { isUuid } from "../utils/requestMeta.js";

export async function createRequestIntro(data) {
  const result = await getPool().query(
    `INSERT INTO request_intros (
      full_name, phone_number, email, project_timeline, additional_notes,
      project_summary, visitor_id, session_id,
      installer_name, installer_snapshot, assessment_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      data.fullName,
      data.phoneNumber,
      data.email,
      data.projectTimeline,
      data.additionalNotes,
      data.projectSummary ? JSON.stringify(data.projectSummary) : null,
      isUuid(data.visitorId) ? data.visitorId : null,
      isUuid(data.sessionId) ? data.sessionId : null,
      data.installerName || "",
      data.installerSnapshot ? JSON.stringify(data.installerSnapshot) : null,
      data.assessmentId || null,
    ],
  );

  return result.rows[0];
}

export async function getRequestIntroById(id) {
  const result = await getPool().query(
    `SELECT * FROM request_intros WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateRequestIntroReview(id, { status, adminNotes }) {
  const result = await getPool().query(
    `UPDATE request_intros
     SET status = COALESCE($2::text, status),
         admin_notes = COALESCE($3::text, admin_notes),
         status_updated_at = CASE
           WHEN $2::text IS NOT NULL AND $2::text <> status THEN NOW()
           ELSE status_updated_at
         END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, status ?? null, adminNotes ?? null],
  );
  return result.rows[0] ?? null;
}
