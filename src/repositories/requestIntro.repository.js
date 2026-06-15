import { getPool } from "../config/database.js";

export async function createRequestIntro(data) {
  const result = await getPool().query(
    `INSERT INTO request_intros (
      full_name, phone_number, email, project_timeline, additional_notes, project_summary
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id`,
    [
      data.fullName,
      data.phoneNumber,
      data.email,
      data.projectTimeline,
      data.additionalNotes,
      data.projectSummary ? JSON.stringify(data.projectSummary) : null,
    ],
  );

  return result.rows[0];
}
