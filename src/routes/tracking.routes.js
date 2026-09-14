import { Router } from "express";
import {
  upsertVisitorAndSession,
} from "../repositories/visitor.repository.js";
import {
  createActivityEvent,
  createActivityEvents,
  normalizeEventType,
} from "../repositories/activity.repository.js";
import {
  getClientIp,
  getUserAgent,
  getVisitorIdFromRequest,
  getSessionIdFromRequest,
} from "../utils/requestMeta.js";

const router = Router();

router.post("/session", async (req, res, next) => {
  try {
    const visitorId = getVisitorIdFromRequest(req);
    const sessionId = getSessionIdFromRequest(req);
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);

    const result = await upsertVisitorAndSession({
      visitorId,
      sessionId,
      ip,
      userAgent,
      landingPath: req.body?.landingPath || req.body?.path || "",
      referrer: req.body?.referrer || "",
      city: req.body?.city || "",
      region: req.body?.region || "",
      country: req.body?.country || "",
    });

    res.json({
      success: true,
      data: {
        visitorId: result.visitorId,
        sessionId: result.sessionId,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/events", async (req, res, next) => {
  try {
    const ip = getClientIp(req);
    const userAgent = getUserAgent(req);
    let visitorId =
      getVisitorIdFromRequest(req) || req.body?.visitorId || null;
    let sessionId =
      getSessionIdFromRequest(req) || req.body?.sessionId || null;

    if (visitorId) {
      const resolved = await upsertVisitorAndSession({
        visitorId,
        sessionId,
        ip,
        userAgent,
        landingPath: req.body?.path || "",
        referrer: "",
      });
      visitorId = resolved.visitorId;
      sessionId = resolved.sessionId;
    }

    const rawEvents = Array.isArray(req.body?.events)
      ? req.body.events
      : [req.body];

    const normalized = [];
    for (const event of rawEvents) {
      if (!event || typeof event !== "object") continue;
      const eventType = normalizeEventType(event.eventType || event.type);
      if (!eventType) continue;
      normalized.push({
        visitorId: event.visitorId || visitorId,
        sessionId: event.sessionId || sessionId,
        eventType,
        path: event.path || "",
        entityType: event.entityType || "",
        entityId: event.entityId != null ? String(event.entityId) : "",
        metadata: event.metadata || {},
        ip,
        userAgent,
      });
    }

    if (normalized.length === 0) {
      res.status(400).json({
        success: false,
        message: "No valid events provided",
      });
      return;
    }

    const created =
      normalized.length === 1
        ? [await createActivityEvent(normalized[0])]
        : await createActivityEvents(normalized);

    res.status(201).json({
      success: true,
      data: { count: created.length },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
