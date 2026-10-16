import { Router } from "express";
import { createContactMessage } from "../repositories/contactMessage.repository.js";
import { validateContact } from "../middleware/validate.js";
import { createActivityEvent } from "../repositories/activity.repository.js";
import { resolveVisitorContext } from "../utils/resolveVisitorContext.js";

const router = Router();

router.post("/", validateContact, async (req, res, next) => {
  try {
    const {
      fullName,
      phoneNumber,
      email,
      projectTimeline,
      additionalNotes,
    } = req.body;

    const { visitorId, sessionId, ip, userAgent } =
      await resolveVisitorContext(req);

    const submission = await createContactMessage({
      fullName: fullName.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email.trim().toLowerCase(),
      projectTimeline: projectTimeline?.trim() || "",
      additionalNotes: additionalNotes?.trim() || "",
      visitorId,
      sessionId,
    });

    await createActivityEvent({
      visitorId,
      sessionId,
      eventType: "contact_submitted",
      path: "/contact",
      entityType: "contact_message",
      entityId: String(submission.id),
      metadata: { email: email.trim().toLowerCase() },
      ip,
      userAgent,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: "Contact message submitted successfully",
      data: { id: submission.id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
