import { getPool } from "../config/database.js";
import { isUuid } from "../utils/requestMeta.js";

export async function createRequestIntro(data) {
  const result = await getPool().query(
    `INSERT INTO request_intros (
      full_name, phone_number, email, project_timeline, additional_notes,
      project_summary, visitor_id, session_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    ],
  );

  return result.rows[0];
}
