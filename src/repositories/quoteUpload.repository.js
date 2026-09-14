import { getPool } from "../config/database.js";
import { isUuid } from "../utils/requestMeta.js";

export async function createQuoteUpload(data) {
  const result = await getPool().query(
    `INSERT INTO quote_uploads (
       visitor_id, session_id, assessment_id, full_name, email, phone_number,
       location, original_name, stored_name, mime_type, size_bytes, storage_path
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, created_at`,
    [
      isUuid(data.visitorId) ? data.visitorId : null,
      isUuid(data.sessionId) ? data.sessionId : null,
      data.assessmentId || null,
      data.fullName || "",
      data.email || "",
      data.phoneNumber || "",
      data.location || "",
      data.originalName,
      data.storedName,
      data.mimeType || "",
      data.sizeBytes || 0,
      data.storagePath,
    ],
  );

  return result.rows[0];
}

export async function getQuoteUploadById(id) {
  const result = await getPool().query(
    `SELECT *
     FROM quote_uploads
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
