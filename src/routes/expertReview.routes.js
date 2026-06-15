import { Router } from "express";
import { createExpertReview } from "../repositories/expertReview.repository.js";
import { validateExpertReview } from "../middleware/validate.js";

const router = Router();

router.post("/", validateExpertReview, async (req, res, next) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      projectLocation,
      reviewType,
      additionalNotes,
      attachmentFileName,
    } = req.body;

    const submission = await createExpertReview({
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email.trim().toLowerCase(),
      projectLocation: projectLocation.trim(),
      reviewType: reviewType?.trim() || "",
      additionalNotes: additionalNotes?.trim() || "",
      attachmentFileName: attachmentFileName?.trim() || "",
    });

    res.status(201).json({
      success: true,
      message: "Expert review request submitted successfully",
      data: { id: submission.id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
