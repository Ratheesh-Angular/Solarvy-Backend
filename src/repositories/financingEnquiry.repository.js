import { randomInt } from "crypto";
import { getPool } from "../config/database.js";
import { isUuid } from "../utils/requestMeta.js";

export const FINANCING_STATUSES = [
  "new",
  "in_review",
  "sent_to_partner",
  "closed",
];

const MAX_REFERENCE_ATTEMPTS = 5;

function createReference() {
  return `SV-FIN-${randomInt(10000, 100000)}`;
}

function isUniqueViolation(error) {
  return error?.code === "23505";
}

export async function createFinancingEnquiry(data) {
  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    const reference = createReference();
    try {
      const result = await getPool().query(
        `INSERT INTO financing_enquiries (
           reference, visitor_id, session_id, assessment_id,
           applicant_type, amount_to_finance, deposit_available,
           repayment_period, repayment_label, income_range, location, notes,
           route_id, route_label, partner_id, partner_name,
           partner_snapshot, shared_items, project_snapshot,
           consent_share, confirm_accurate, confirm_terms
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
         )
         RETURNING id, reference, created_at`,
        [
          reference,
          isUuid(data.visitorId) ? data.visitorId : null,
          isUuid(data.sessionId) ? data.sessionId : null,
          data.assessmentId || null,
          data.applicantType,
          data.amountToFinance,
          data.depositAvailable,
          data.repaymentPeriod,
          data.repaymentLabel,
          data.incomeRange,
          data.location,
          data.notes,
          data.routeId,
          data.routeLabel,
          data.partnerId,
          data.partnerName,
          JSON.stringify(data.partnerSnapshot ?? {}),
          JSON.stringify(data.sharedItems ?? []),
          JSON.stringify(data.projectSnapshot ?? {}),
          Boolean(data.consentShare),
          Boolean(data.confirmAccurate),
          Boolean(data.confirmTerms),
        ],
      );
      return result.rows[0];
    } catch (error) {
      if (isUniqueViolation(error) && attempt < MAX_REFERENCE_ATTEMPTS - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Could not generate a unique financing reference");
}

export async function getFinancingEnquiryById(id) {
  const result = await getPool().query(
    `SELECT * FROM financing_enquiries WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updateFinancingEnquiryReview(id, { status, adminNotes }) {
  const result = await getPool().query(
    `UPDATE financing_enquiries
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
