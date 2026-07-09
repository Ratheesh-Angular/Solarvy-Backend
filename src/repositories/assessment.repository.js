import { getPool } from "../config/database.js";

export async function createDraft(formData) {
  const result = await getPool().query(
    `INSERT INTO assessment_drafts (form_data)
     VALUES ($1)
     RETURNING id, form_data, created_at, updated_at`,
    [JSON.stringify(formData ?? {})],
  );

  return result.rows[0];
}

export async function getDraftById(id) {
  const result = await getPool().query(
    `SELECT id, form_data, created_at, updated_at
     FROM assessment_drafts
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] ?? null;
}

export async function updateDraft(id, formData) {
  const result = await getPool().query(
    `UPDATE assessment_drafts
     SET form_data = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, form_data, created_at, updated_at`,
    [id, JSON.stringify(formData ?? {})],
  );

  return result.rows[0] ?? null;
}

export async function createAssessmentFromDraft(draftId, formData, results = null) {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    if (draftId) {
      await client.query(
        `UPDATE assessment_drafts
         SET form_data = $2, updated_at = NOW()
         WHERE id = $1`,
        [draftId, JSON.stringify(formData ?? {})],
      );
    }

    const result = await client.query(
      `INSERT INTO assessments (draft_id, form_data, results)
       VALUES ($1, $2, $3)
       RETURNING id, draft_id, form_data, results, created_at`,
      [
        draftId || null,
        JSON.stringify(formData ?? {}),
        results ? JSON.stringify(results) : null,
      ],
    );

    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAssessmentById(id) {
  const result = await getPool().query(
    `SELECT id, draft_id, form_data, results, created_at, updated_at
     FROM assessments
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] ?? null;
}
