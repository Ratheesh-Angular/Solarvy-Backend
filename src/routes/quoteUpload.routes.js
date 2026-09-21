import { Router } from "express";
import multer from "multer";
import { createQuoteUpload } from "../repositories/quoteUpload.repository.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { saveUpload } from "../services/fileStorage.service.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";
import { parseAssessmentIdParam } from "../utils/assessmentId.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: "No file uploaded. Use form field name 'file'.",
      });
      return;
    }

    const { visitorId, sessionId, ip, userAgent } =
      await resolveVisitorContext(req);

    let assessmentId = null;
    if (req.body?.assessmentId) {
      const parsed = parseAssessmentIdParam(req.body.assessmentId);
      if (Number.isFinite(parsed)) assessmentId = parsed;
    }

    const saved = await saveUpload("quote-uploads", req.file);
    const row = await createQuoteUpload({
      visitorId,
      sessionId,
      assessmentId,
      fullName: String(req.body?.fullName || "").trim(),
      email: String(req.body?.email || "").trim().toLowerCase(),
      phoneNumber: String(req.body?.phoneNumber || "").trim(),
      location: String(req.body?.location || "").trim(),
      additionalNotes: String(req.body?.additionalNotes || "").trim(),
      originalName: saved.originalName,
      storedName: saved.storedName,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      storagePath: saved.storagePath,
    });

    await createActivityEvent({
      visitorId,
      sessionId,
      eventType: "quote_upload_submitted",
      path: "/matched-installers",
      entityType: "quote_upload",
      entityId: String(row.id),
      metadata: {
        originalName: saved.originalName,
        assessmentId: assessmentId,
      },
      ip,
      userAgent,
    });

    res.status(201).json({
      success: true,
      message: "Quote uploaded successfully",
      data: { id: row.id, createdAt: row.created_at },
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
});

export default router;
