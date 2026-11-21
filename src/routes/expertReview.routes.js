import { Router } from "express";
import multer from "multer";
import { createExpertReview } from "../repositories/expertReview.repository.js";
import { validateExpertReview } from "../middleware/validate.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { saveUpload } from "../services/fileStorage.service.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";
import { formatAssessmentId, parseAssessmentIdParam } from "../utils/assessmentId.js";
import { sendExpertReviewConfirmationEmail } from "../services/email.service.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function parseJsonField(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function normalizeInstallerSnapshot(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const name = String(raw.installerName ?? raw.installer_name ?? "").trim();
  if (!name) return null;
  return {
    installerName: name,
    cardNumber:
      raw.cardNumber != null && Number.isFinite(Number(raw.cardNumber))
        ? Number(raw.cardNumber)
        : raw.card_number != null && Number.isFinite(Number(raw.card_number))
          ? Number(raw.card_number)
          : null,
    matchPct:
      raw.matchPct != null && Number.isFinite(Number(raw.matchPct))
        ? Number(raw.matchPct)
        : raw.match_pct != null && Number.isFinite(Number(raw.match_pct))
          ? Number(raw.match_pct)
          : null,
    matchTier: String(raw.matchTier ?? raw.match_tier ?? "").trim() || null,
    bestSuitedFor:
      String(raw.bestSuitedFor ?? raw.best_suited_for ?? "").trim() || null,
    coverage: String(raw.coverage ?? "").trim() || null,
    strengths: String(raw.strengths ?? "").trim() || null,
    pricing: String(raw.pricing ?? "").trim() || null,
    response: String(raw.response ?? "").trim() || null,
  };
}

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
        installerName,
        installerSnapshot,
        assessmentId: bodyAssessmentId,
      } = req.body;

      const { visitorId, sessionId, ip, userAgent } =
        await resolveVisitorContext(req);

      const snapshot =
        normalizeInstallerSnapshot(parseJsonField(installerSnapshot)) ||
        (typeof installerName === "string" && installerName.trim()
          ? { installerName: installerName.trim() }
          : null);

      let assessmentId = null;
      const parsed = parseAssessmentIdParam(bodyAssessmentId);
      if (Number.isFinite(parsed)) assessmentId = parsed;

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
        installerName: snapshot?.installerName || "",
        installerSnapshot: snapshot,
        assessmentId,
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
          installerName: snapshot?.installerName || null,
          assessmentId,
        },
        ip,
        userAgent,
      }).catch(() => {});

      await sendExpertReviewConfirmationEmail({
        to: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        installerName: snapshot?.installerName || "",
        assessmentRef: assessmentId ? formatAssessmentId(assessmentId) : "",
        reviewType: reviewType?.trim() || "",
        hasAttachment: Boolean(fileMeta.storagePath),
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
