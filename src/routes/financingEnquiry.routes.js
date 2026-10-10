import { Router } from "express";
import { createFinancingEnquiry } from "../repositories/financingEnquiry.repository.js";
import { getAssessmentById } from "../repositories/assessment.repository.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { validateFinancingEnquiry } from "../middleware/validate.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";
import {
  formatAssessmentId,
  parseAssessmentIdParam,
} from "../utils/assessmentId.js";

const router = Router();

function clip(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function clipList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string" && item.trim())
    .slice(0, maxItems)
    .map((item) => item.trim().slice(0, maxLength));
}

function buildProjectSnapshot(assessment) {
  if (!assessment) return {};
  const results = assessment.results || {};
  const form = assessment.form_data || {};
  return {
    assessmentRef: formatAssessmentId(assessment.id),
    estimatedSystemCost: toNumberOrNull(results.estimatedSystemCost),
    recommendedSolarKwp: toNumberOrNull(results.recommendedSolarKwp),
    recommendedBatteryKwh: toNumberOrNull(results.recommendedBatteryKwh),
    netAnnualSavings: toNumberOrNull(results.netAnnualSavings),
    propertyType:
      String(results.propertyType || form.propertyType || "").trim() || null,
    city: String(form.city || results.city || "").trim() || null,
    state: String(form.state || "").trim() || null,
  };
}

router.post("/", validateFinancingEnquiry, async (req, res, next) => {
  try {
    const body = req.body;
    const { visitorId, sessionId, ip, userAgent } =
      await resolveVisitorContext(req);

    const numericAssessmentId = parseAssessmentIdParam(body.assessmentId);
    let assessment = null;
    if (Number.isInteger(numericAssessmentId) && numericAssessmentId > 0) {
      assessment = await getAssessmentById(numericAssessmentId).catch(
        () => null,
      );
    }

    const partnerSnapshot = {
      id: clip(body.partner?.id ?? body.partnerId, 120),
      name: clip(body.partner?.name ?? body.partnerName, 255),
      description: clip(body.partner?.description, 1000),
      requirements: clipList(body.partner?.requirements, 20, 300),
    };

    const deposit = toNumberOrNull(body.depositAvailable);

    const submission = await createFinancingEnquiry({
      visitorId,
      sessionId,
      assessmentId: assessment?.id ?? null,
      applicantType: clip(body.applicantType, 120),
      amountToFinance: Number(body.amountToFinance),
      depositAvailable: deposit,
      repaymentPeriod: clip(body.repaymentPeriod, 40),
      repaymentLabel: clip(body.repaymentLabel, 80),
      incomeRange: clip(body.incomeRange, 80),
      location: clip(body.location, 120),
      notes: clip(body.notes, 2000),
      routeId: clip(body.routeId, 80),
      routeLabel: clip(body.routeLabel, 160),
      partnerId: partnerSnapshot.id,
      partnerName: partnerSnapshot.name,
      partnerSnapshot,
      sharedItems: clipList(body.sharedItems, 20, 300),
      projectSnapshot: {
        ...buildProjectSnapshot(assessment),
        requestedAssessmentRef: clip(String(body.assessmentId ?? ""), 40) || null,
      },
      consentShare: body.consentShare === true,
      confirmAccurate: body.confirmAccurate === true,
      confirmTerms: body.confirmTerms === true,
    });

    await createActivityEvent({
      visitorId,
      sessionId,
      eventType: "financing_enquiry_submitted",
      path: "/financing-enquiry",
      entityType: "financing_enquiry",
      entityId: String(submission.id),
      metadata: {
        reference: submission.reference,
        partnerName: partnerSnapshot.name,
        routeId: clip(body.routeId, 80),
      },
      ip,
      userAgent,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Financing enquiry submitted successfully",
      data: {
        id: submission.id,
        reference: submission.reference,
        submittedAt: submission.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
