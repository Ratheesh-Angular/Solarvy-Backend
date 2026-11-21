import { Router } from "express";
import { createRequestIntro } from "../repositories/requestIntro.repository.js";
import { validateRequestIntro } from "../middleware/validate.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";
import { formatAssessmentId, parseAssessmentIdParam } from "../utils/assessmentId.js";
import { sendRequestIntroConfirmationEmail } from "../services/email.service.js";

const router = Router();

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

router.post("/", validateRequestIntro, async (req, res, next) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      projectTimeline,
      additionalNotes,
      projectSummary,
      installer,
      installerName,
      installerSnapshot,
      assessmentId: bodyAssessmentId,
    } = req.body;

    const { visitorId, sessionId, ip, userAgent } =
      await resolveVisitorContext(req);

    const snapshot =
      normalizeInstallerSnapshot(installer) ||
      normalizeInstallerSnapshot(installerSnapshot) ||
      (typeof installerName === "string" && installerName.trim()
        ? { installerName: installerName.trim() }
        : null);

    let assessmentId = null;
    const parsed = parseAssessmentIdParam(bodyAssessmentId);
    if (Number.isFinite(parsed)) assessmentId = parsed;

    const submission = await createRequestIntro({
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email.trim().toLowerCase(),
      projectTimeline: projectTimeline?.trim() || "",
      additionalNotes: additionalNotes?.trim() || "",
      projectSummary: projectSummary ?? null,
      visitorId,
      sessionId,
      installerName: snapshot?.installerName || "",
      installerSnapshot: snapshot,
      assessmentId,
    });

    await createActivityEvent({
      visitorId,
      sessionId,
      eventType: "request_intro_submitted",
      path: "/request-intro",
      entityType: "request_intro",
      entityId: String(submission.id),
      metadata: {
        email: email.trim().toLowerCase(),
        installerName: snapshot?.installerName || null,
        assessmentId,
      },
      ip,
      userAgent,
    }).catch(() => {});

    await sendRequestIntroConfirmationEmail({
      to: email.trim().toLowerCase(),
      fullName: fullName.trim(),
      installerName: snapshot?.installerName || "",
      assessmentRef: assessmentId ? formatAssessmentId(assessmentId) : "",
      projectTimeline: projectTimeline?.trim() || "",
    }).catch(() => {});

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
