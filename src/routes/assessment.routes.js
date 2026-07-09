import { Router } from "express";
import {
  createDraft,
  getDraftById,
  updateDraft,
  createAssessmentFromDraft,
  getAssessmentById,
} from "../repositories/assessment.repository.js";
import { calculateAssessment } from "../services/excelCalculator.service.js";

const router = Router();

function formatAssessmentId(id) {
  return `SV-${String(id).padStart(4, "0")}`;
}

function parseAssessmentIdParam(value) {
  if (!value) return NaN;
  const normalized = String(value).trim().toUpperCase();
  const match = normalized.match(/^SV-(\d+)$/);
  if (match) {
    return Number(match[1]);
  }
  return Number(normalized);
}

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
    const draft = await createDraft(req.body.formData ?? req.body);

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

    const formData = req.body.formData ?? req.body;
    const results = await runExcelCalculation(formData);
    const assessment = await createAssessmentFromDraft(draftId, formData, results);

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
    const formData = req.body.formData ?? req.body;
    const results = await runExcelCalculation(formData);
    const assessment = await createAssessmentFromDraft(null, formData, results);

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
