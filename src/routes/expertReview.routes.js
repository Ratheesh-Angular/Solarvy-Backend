import { Router } from "express";
import multer from "multer";
import { createExpertReview } from "../repositories/expertReview.repository.js";
import { validateExpertReview } from "../middleware/validate.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { saveUpload } from "../services/fileStorage.service.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post(
  "/",
  upload.single("attachment"),
  validateExpertReview,
  async (req, res, next) => {
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

      const { visitorId, sessionId, ip, userAgent } =
        await resolveVisitorContext(req);

      let fileMeta = {
        attachmentFileName: attachmentFileName?.trim() || "",
        storedFileName: "",
        mimeType: "",
        sizeBytes: 0,
        storagePath: "",
      };

      if (req.file) {
        const saved = await saveUpload("expert-reviews", req.file);
        fileMeta = {
          attachmentFileName: saved.originalName,
          storedFileName: saved.storedName,
          mimeType: saved.mimeType,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
        };
      }

      const submission = await createExpertReview({
        fullName: fullName.trim(),
        phoneNumber: phoneNumber.trim(),
        email: email.trim().toLowerCase(),
        projectLocation: projectLocation.trim(),
        reviewType: reviewType?.trim() || "",
        additionalNotes: additionalNotes?.trim() || "",
        ...fileMeta,
        visitorId,
        sessionId,
      });

      await createActivityEvent({
        visitorId,
        sessionId,
        eventType: "expert_review_submitted",
        path: "/expert-review",
        entityType: "expert_review",
        entityId: String(submission.id),
        metadata: {
          email: email.trim().toLowerCase(),
          hasAttachment: Boolean(fileMeta.storagePath),
        },
        ip,
        userAgent,
      }).catch(() => {});

      res.status(201).json({
        success: true,
        message: "Expert review request submitted successfully",
        data: { id: submission.id },
      });
    } catch (error) {
      if (
        error.message?.includes("Unsupported file type") ||
        error.message?.includes("No file uploaded") ||
        error.message?.includes("File too large")
      ) {
        res.status(400).json({ success: false, message: error.message });
        return;
      }
      next(error);
    }
  },
);

export default router;
