import { Router } from "express";
import { createRequestIntro } from "../repositories/requestIntro.repository.js";
import { validateRequestIntro } from "../middleware/validate.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";

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

    const { visitorId, sessionId, ip, userAgent } =
      await resolveVisitorContext(req);

    const submission = await createRequestIntro({
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email.trim().toLowerCase(),
      projectTimeline: projectTimeline?.trim() || "",
      additionalNotes: additionalNotes?.trim() || "",
      projectSummary: projectSummary ?? null,
      visitorId,
      sessionId,
    });

    await createActivityEvent({
      visitorId,
      sessionId,
      eventType: "request_intro_submitted",
      path: "/request-intro",
      entityType: "request_intro",
      entityId: String(submission.id),
      metadata: { email: email.trim().toLowerCase() },
      ip,
      userAgent,
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
