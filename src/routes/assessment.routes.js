import { Router } from "express";
import { createAssessment } from "../repositories/assessment.repository.js";
import { validateAssessment } from "../middleware/validate.js";

const router = Router();

router.post("/", validateAssessment, async (req, res, next) => {
  try {
    const {
      country,
      state,
      propertyType,
      powerSource,
      inputMethod,
      objective,
      category,
      loadRows,
      results,
    } = req.body;

    const submission = await createAssessment({
      country: country.trim(),
      state: state?.trim() || "",
      propertyType: propertyType?.trim() || "",
      powerSource: powerSource?.trim() || "",
      inputMethod: inputMethod?.trim() || "",
      objective: objective?.trim() || "",
      category: category?.trim() || "",
      loadRows: loadRows ?? [],
      results: results ?? null,
    });

    res.status(201).json({
      success: true,
      message: "Assessment saved successfully",
      data: { id: submission.id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
