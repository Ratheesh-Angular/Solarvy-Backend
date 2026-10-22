import { Router } from "express";
import { getCatalogs } from "../services/excelReader.service.js";
import {
  calculateAssessment,
  filterPreliminaryFinanceMatches,
  getLiveSummary,
  getTemplatePrefill,
} from "../services/excelCalculator.service.js";
import { getAssessmentById } from "../repositories/assessment.repository.js";
import { parseAssessmentIdParam } from "../utils/assessmentId.js";

const router = Router();

function normalizeFinancePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const consentRaw = raw.consent;
  let consent = null;
  if (consentRaw === true || consentRaw === "Yes" || consentRaw === "yes") {
    consent = "Yes";
  } else if (
    consentRaw === false ||
    consentRaw === "No" ||
    consentRaw === "no"
  ) {
    consent = "No";
  } else if (typeof consentRaw === "string" && consentRaw.trim()) {
    consent = consentRaw.trim();
  }

  return {
    depositAvailable:
      raw.depositAvailable !== undefined && raw.depositAvailable !== null
        ? Number(raw.depositAvailable)
        : null,
    preferredRoute: raw.preferredRoute
      ? String(raw.preferredRoute).trim()
      : null,
    repaymentTerm: raw.repaymentTerm
      ? String(raw.repaymentTerm).trim()
      : null,
    applicantType: raw.applicantType
      ? String(raw.applicantType).trim()
      : null,
    location: raw.location ? String(raw.location).trim() : null,
    incomeRange: raw.incomeRange ? String(raw.incomeRange).trim() : null,
    consent,
  };
}

router.get("/catalogs", async (_req, res, next) => {
  try {
    const catalogs = await getCatalogs();
    res.json({ success: true, data: catalogs });
  } catch (error) {
    next(error);
  }
});

router.post("/template-prefill", async (req, res, next) => {
  try {
    const { propertyType, template } = req.body;

    if (!propertyType || !template) {
      res.status(400).json({
        success: false,
        message: "propertyType and template are required",
      });
      return;
    }

    const prefill = await getTemplatePrefill(propertyType, template);
    res.json({ success: true, data: prefill });
  } catch (error) {
    next(error);
  }
});

router.post("/live-summary", async (req, res, next) => {
  try {
    const formData = req.body.formData ?? req.body;
    const summary = await getLiveSummary(formData);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

/**
 * Re-run assessment calc with Finance_Request inputs, return preliminary matches.
 * Body: { assessmentId, finance: { depositAvailable, preferredRoute, ... } }
 */
router.post("/finance-matches", async (req, res, next) => {
  try {
    const assessmentId = parseAssessmentIdParam(
      req.body.assessmentId ?? req.body.assessment,
    );
    if (!Number.isFinite(assessmentId)) {
      res.status(400).json({
        success: false,
        message: "Valid assessmentId is required",
      });
      return;
    }

    const assessment = await getAssessmentById(assessmentId);
    if (!assessment) {
      res.status(404).json({
        success: false,
        message: "Assessment not found",
      });
      return;
    }

    const finance = normalizeFinancePayload(req.body.finance ?? req.body);
    if (!finance) {
      res.status(400).json({
        success: false,
        message: "finance payload is required",
      });
      return;
    }

    const formData = {
      ...(assessment.form_data || {}),
      finance,
    };

    const results = await calculateAssessment(formData);
    const preferredRoute = finance.preferredRoute || "";
    const allMatches = Array.isArray(results.financeMatches)
      ? results.financeMatches
      : [];
    const matches = filterPreliminaryFinanceMatches(allMatches, preferredRoute);

    res.json({
      success: true,
      data: {
        amountRequested: results.financeAmountRequested ?? null,
        requestValid: results.financeRequestValid ?? null,
        preferredRoute: preferredRoute || null,
        matches,
        allMatches,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
