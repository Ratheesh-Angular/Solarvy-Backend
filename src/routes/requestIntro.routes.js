import { Router } from "express";
import { createRequestIntro } from "../repositories/requestIntro.repository.js";
import { validateRequestIntro } from "../middleware/validate.js";

const router = Router();

router.post("/", validateRequestIntro, async (req, res, next) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      projectTimeline,
      additionalNotes,
      projectSummary,
    } = req.body;

    const submission = await createRequestIntro({
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email.trim().toLowerCase(),
      projectTimeline: projectTimeline?.trim() || "",
      additionalNotes: additionalNotes?.trim() || "",
      projectSummary: projectSummary ?? null,
    });

    res.status(201).json({
      success: true,
      message: "Introduction request submitted successfully",
      data: { id: submission.id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
