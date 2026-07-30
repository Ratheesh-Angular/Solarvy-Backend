/**
 * Re-run Excel calculation for an existing assessment and update results.
 *
 * Usage: node scripts/recalc-assessment.mjs SV-0016
 */
import "dotenv/config";
import {
  connectDatabase,
  disconnectDatabase,
  getPool,
} from "../src/config/database.js";
import { calculateAssessment } from "../src/services/excelCalculator.service.js";

function parseAssessmentId(value) {
  if (!value) return NaN;
  const normalized = String(value).trim().toUpperCase();
  const match = normalized.match(/^SV-(\d+)$/);
  if (match) return Number(match[1]);
  return Number(normalized);
}

const idParam = process.argv[2] || "SV-0016";
const id = parseAssessmentId(idParam);

if (!Number.isFinite(id)) {
  console.error("Usage: node scripts/recalc-assessment.mjs SV-0016");
  process.exit(1);
}

await connectDatabase();

try {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, form_data, results FROM assessments WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    console.error(`Assessment ${idParam} not found`);
    process.exit(1);
  }

  const formData = row.form_data;
  console.log(`Recalculating SV-${String(id).padStart(4, "0")}...`);
  console.log(
    `inputMethod=${formData.inputMethod} monthlyUsage=${formData.bill?.monthlyUsage}`,
  );

  const before = row.results || {};
  console.log("Before:", {
    solar: before.recommendedSolarKwp,
    battery: before.recommendedBatteryKwh,
    inverter: before.recommendedInverterKw,
    solarShare: before.solarShare,
    gridOffset: before.gridOffset,
    dieselReduction: before.dieselReduction,
  });

  const results = await calculateAssessment(formData);
  if (results.calculationError) {
    console.error("Calculation failed:", results.calculationError);
    process.exit(1);
  }

  await pool.query(
    `UPDATE assessments
     SET results = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, JSON.stringify(results)],
  );

  console.log("After:", {
    solar: results.recommendedSolarKwp,
    battery: results.recommendedBatteryKwh,
    inverter: results.recommendedInverterKw,
    cost: results.estimatedSystemCost,
    solarShare: results.solarShare,
    gridOffset: results.gridOffset,
    dieselReduction: results.dieselReduction,
  });
  console.log(`Updated SV-${String(id).padStart(4, "0")} results in database.`);
} finally {
  await disconnectDatabase();
}
