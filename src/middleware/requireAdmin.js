import { verifyAdminToken } from "../services/adminAuth.service.js";

export async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();

    if (!token) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const admin = await verifyAdminToken(token);
    if (!admin) {
      res.status(401).json({
        success: false,
        message: "Invalid or expired session",
      });
      return;
    }

    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireSuperAdmin(req, res, next) {
  if (!req.admin) {
    res.status(401).json({
      success: false,
      message: "Authentication required",
    });
    return;
  }

  if (!req.admin.isSuperAdmin) {
    res.status(403).json({
      success: false,
      message: "Super admin access required",
    });
    return;
  }

  next();
}

export function requireAdminPermission(...pageKeys) {
  const keys = pageKeys.flat().filter(Boolean);

  return function requirePermission(req, res, next) {
    if (!req.admin) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    if (req.admin.isSuperAdmin) {
      next();
      return;
    }

    const permissions = Array.isArray(req.admin.permissions)
      ? req.admin.permissions
      : [];

    const allowed = keys.some((key) => permissions.includes(key));
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: "You do not have access to this resource",
      });
      return;
    }

    next();
  };
}
