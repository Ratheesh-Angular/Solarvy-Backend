import { Router } from "express";
import { verifyUserToken } from "../services/userAuth.service.js";
import { getVisitorIdFromRequest } from "../utils/requestMeta.js";
import {
  listProjectsForVisitors,
  resolveProjectsViewer,
} from "../repositories/projects.repository.js";

const router = Router();

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

router.get("/", async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    const user = await verifyUserToken(token, req);
    const visitorId = getVisitorIdFromRequest(req);

    const viewer =
      (await resolveProjectsViewer({
        visitorId,
        userId: user?.id || null,
      })) || {
        visitorId: visitorId || null,
        visitorIds: visitorId ? [visitorId] : [],
        userId: user?.id || null,
        fullName: user?.fullName || null,
        email: user?.email || null,
        kind: user ? "account" : "guest",
        scope: user ? "account" : "current_browser",
        isGuest: !user,
      };

    const visitorIds =
      Array.isArray(viewer.visitorIds) && viewer.visitorIds.length
        ? viewer.visitorIds
        : viewer.visitorId
          ? [viewer.visitorId]
          : [];

    const workspace = await listProjectsForVisitors(visitorIds);

    res.json({
      success: true,
      data: {
        viewer: {
          visitorId: viewer.visitorId,
          userId: viewer.userId,
          fullName: viewer.fullName,
          email: viewer.email,
          kind: viewer.kind,
          isAuthenticated: Boolean(user),
          isGuest:
            typeof viewer.isGuest === "boolean"
              ? viewer.isGuest
              : !user,
          scope: viewer.scope,
        },
        ...workspace,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
