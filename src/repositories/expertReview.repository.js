import { getPool } from "../config/database.js";
import { isUuid } from "../utils/requestMeta.js";

export async function createExpertReview(data) {
  const result = await getPool().query(
    `INSERT INTO expert_reviews (
      full_name, phone_number, email, project_location,
      review_type, additional_notes, attachment_file_name,
      stored_file_name, mime_type, size_bytes, storage_path,
      visitor_id, session_id,
      installer_name, installer_snapshot, assessment_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING id`,
    [
      data.fullName,
      data.phoneNumber,
      data.email,
      data.projectLocation,
      data.reviewType,
      data.additionalNotes,
      data.attachmentFileName || "",
      data.storedFileName || "",
      data.mimeType || "",
      data.sizeBytes || 0,
      data.storagePath || "",
      isUuid(data.visitorId) ? data.visitorId : null,
      isUuid(data.sessionId) ? data.sessionId : null,
      data.installerName || "",
      data.installerSnapshot ? JSON.stringify(data.installerSnapshot) : null,
      data.assessmentId || null,
    ],
  );

  return result.rows[0];
}

export async function getExpertReviewById(id) {
  const result = await getPool().query(
    `SELECT * FROM expert_reviews WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
