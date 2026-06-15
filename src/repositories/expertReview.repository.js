import { getPool } from "../config/database.js";

export async function createExpertReview(data) {
  const result = await getPool().query(
    `INSERT INTO expert_reviews (
      full_name, phone_number, email, project_location,
      review_type, additional_notes, attachment_file_name
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id`,
    [
      data.fullName,
      data.phoneNumber,
      data.email,
      data.projectLocation,
      data.reviewType,
      data.additionalNotes,
      data.attachmentFileName,
    ],
  );

  return result.rows[0];
}
