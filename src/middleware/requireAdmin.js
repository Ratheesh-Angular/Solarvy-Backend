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
