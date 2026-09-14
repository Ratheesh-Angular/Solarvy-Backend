import { Router } from "express";
import {
  createDraft,
  getDraftById,
  updateDraft,
  createAssessmentFromDraft,
  getAssessmentById,
  updateAssessmentResults,
} from "../repositories/assessment.repository.js";
import { calculateAssessment } from "../services/excelCalculator.service.js";
import { withAiRecommendation } from "../services/recommendation.service.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import {
  formatAssessmentId,
  parseAssessmentIdParam,
} from "../utils/assessmentId.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";

const router = Router();

async function runExcelCalculation(formData) {
  try {
    return await calculateAssessment(formData);
  } catch (error) {
    // Calculation failure should not lose the user's submission — the
    // assessment is stored without results and can be recalculated later.
    console.error("Excel calculation failed:", error.message);
    return { calculationError: error.message };
  }
}

router.post("/drafts", async (req, res, next) => {
  try {
    const meta = await resolveVisitorContext(req);
    const draft = await createDraft(req.body.formData ?? req.body, meta);

    await createActivityEvent({
      visitorId: meta.visitorId,
      sessionId: meta.sessionId,
      eventType: "assessment_started",
      path: "/start-assessment",
      entityType: "assessment_draft",
      entityId: String(draft.id),
      ip: meta.ip,
      userAgent: meta.userAgent,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Assessment draft created",
      data: {
        id: draft.id,
        formData: draft.form_data,
        createdAt: draft.created_at,
        updatedAt: draft.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/drafts/:id", async (req, res, next) => {
  try {
    const draft = await getDraftById(Number(req.params.id));

    if (!draft) {
      res.status(404).json({ success: false, message: "Draft not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        id: draft.id,
        formData: draft.form_data,
        createdAt: draft.created_at,
        updatedAt: draft.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/drafts/:id", async (req, res, next) => {
  try {
    const draft = await updateDraft(
      Number(req.params.id),
      req.body.formData ?? req.body,
    );

    if (!draft) {
      res.status(404).json({ success: false, message: "Draft not found" });
      return;
    }

    res.json({
      success: true,
      message: "Draft saved",
      data: {
        id: draft.id,
        formData: draft.form_data,
        createdAt: draft.created_at,
        updatedAt: draft.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/drafts/:id/complete", async (req, res, next) => {
  try {
    const draftId = Number(req.params.id);
    const draft = await getDraftById(draftId);

    if (!draft) {
      res.status(404).json({ success: false, message: "Draft not found" });
      return;
    }

    const meta = await resolveVisitorContext(req);
    const formData = req.body.formData ?? req.body;
    const results = await runExcelCalculation(formData);
    const assessment = await createAssessmentFromDraft(
      draftId,
      formData,
      results,
      {
        visitorId: meta.visitorId || draft.visitor_id,
        sessionId: meta.sessionId || draft.session_id,
      },
    );

    await createActivityEvent({
      visitorId: meta.visitorId || draft.visitor_id,
      sessionId: meta.sessionId || draft.session_id,
      eventType: "assessment_completed",
      path: "/start-assessment",
      entityType: "assessment",
      entityId: formatAssessmentId(assessment.id),
      ip: meta.ip,
      userAgent: meta.userAgent,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Assessment completed",
      data: {
        id: formatAssessmentId(assessment.id),
        draftId: assessment.draft_id,
        formData: assessment.form_data,
        results: assessment.results,
        createdAt: assessment.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/complete", async (req, res, next) => {
  try {
    const meta = await resolveVisitorContext(req);
    const formData = req.body.formData ?? req.body;
    const results = await runExcelCalculation(formData);
    const assessment = await createAssessmentFromDraft(null, formData, results, meta);

    await createActivityEvent({
      visitorId: meta.visitorId,
      sessionId: meta.sessionId,
      eventType: "assessment_completed",
      path: "/start-assessment",
      entityType: "assessment",
      entityId: formatAssessmentId(assessment.id),
      ip: meta.ip,
      userAgent: meta.userAgent,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Assessment completed",
      data: {
        id: formatAssessmentId(assessment.id),
        draftId: assessment.draft_id,
        formData: assessment.form_data,
        results: assessment.results,
        createdAt: assessment.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/recommendation", async (req, res, next) => {
  try {
    const assessmentId = parseAssessmentIdParam(req.params.id);
    if (!Number.isFinite(assessmentId)) {
      res.status(400).json({ success: false, message: "Invalid assessment id" });
      return;
    }

    const assessment = await getAssessmentById(assessmentId);

    if (!assessment) {
      res.status(404).json({ success: false, message: "Assessment not found" });
      return;
    }

    const results = assessment.results;
    if (!results || typeof results !== "object") {
      res.status(409).json({
        success: false,
        message: "Assessment has no calculated results yet.",
      });
      return;
    }

    if (results.calculationError) {
      res.status(409).json({
        success: false,
        message: "Cannot generate a recommendation while calculation is incomplete.",
      });
      return;
    }

    const existing = String(results.aiRecommendation || "").trim();
    if (existing) {
      res.json({
        success: true,
        data: { aiRecommendation: existing },
      });
      return;
    }

    const withRec = await withAiRecommendation(assessment.form_data, results);
    const text = String(withRec?.aiRecommendation || "").trim() || null;

    if (text) {
      await updateAssessmentResults(assessment.id, {
        ...results,
        aiRecommendation: text,
      });
    }

    res.json({
      success: true,
      data: { aiRecommendation: text },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const assessmentId = parseAssessmentIdParam(req.params.id);
    if (!Number.isFinite(assessmentId)) {
      res.status(400).json({ success: false, message: "Invalid assessment id" });
      return;
    }

    const assessment = await getAssessmentById(assessmentId);

    if (!assessment) {
      res.status(404).json({ success: false, message: "Assessment not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        id: formatAssessmentId(assessment.id),
        draftId: assessment.draft_id,
        formData: assessment.form_data,
        results: assessment.results,
        createdAt: assessment.created_at,
        updatedAt: assessment.updated_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
