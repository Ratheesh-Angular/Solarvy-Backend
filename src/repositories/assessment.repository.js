import { getPool } from "../config/database.js";

export async function createAssessment(data) {
  const result = await getPool().query(
    `INSERT INTO assessments (
      country, state, property_type, power_source, input_method,
      objective, category, load_rows, results
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      data.country,
      data.state,
      data.propertyType,
      data.powerSource,
      data.inputMethod,
      data.objective,
      data.category,
      JSON.stringify(data.loadRows ?? []),
      data.results ? JSON.stringify(data.results) : null,
    ],
  );

  return result.rows[0];
}
