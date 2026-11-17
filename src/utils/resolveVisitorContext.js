import {
  upsertVisitorAndSession,
} from "../repositories/visitor.repository.js";
import {
  getClientIp,
  getUserAgent,
  getVisitorIdFromRequest,
  getSessionIdFromRequest,
} from "../utils/requestMeta.js";
import { lookupIpGeolocation } from "../services/ipGeolocation.service.js";

/**
 * Resolve visitor/session from request headers, creating rows when needed
 * so FK writes never fail for a client-generated visitor UUID.
 */
export async function resolveVisitorContext(req) {
  const visitorId = getVisitorIdFromRequest(req);
  const sessionId = getSessionIdFromRequest(req);
  const ip = getClientIp(req);
  const userAgent = getUserAgent(req);

  if (!visitorId) {
    return { visitorId: null, sessionId: null, ip, userAgent };
  }

  try {
    const geo = await lookupIpGeolocation(ip);
    const result = await upsertVisitorAndSession({
      visitorId,
      sessionId,
      ip,
      userAgent,
      landingPath: req.body?.landingPath || "",
      referrer: "",
      city: geo.city || "",
      region: geo.region || "",
      country: geo.country || "",
    });
    return {
      visitorId: result.visitorId,
      sessionId: result.sessionId,
      ip,
      userAgent,
    };
  } catch {
    return { visitorId, sessionId, ip, userAgent };
  }
}
