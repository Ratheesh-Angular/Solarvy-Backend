import { Router } from "express";
import {
  createDraft,
  getDraftById,
  updateDraft,
  createAssessmentFromDraft,
  getAssessmentById,
} from "../repositories/assessment.repository.js";

const router = Router();

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
    const assessment = await createAssessmentFromDraft(draftId, formData);

    res.status(201).json({
      success: true,
      message: "Assessment completed",
      data: {
        id: assessment.id,
        draftId: assessment.draft_id,
        formData: assessment.form_data,
        createdAt: assessment.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/complete", async (req, res, next) => {
  try {
    const assessment = await createAssessmentFromDraft(
      null,
      req.body.formData ?? req.body,
    );

    res.status(201).json({
      success: true,
      message: "Assessment completed",
      data: {
        id: assessment.id,
        draftId: assessment.draft_id,
        formData: assessment.form_data,
        createdAt: assessment.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const assessment = await getAssessmentById(Number(req.params.id));

    if (!assessment) {
      res.status(404).json({ success: false, message: "Assessment not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        id: assessment.id,
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
