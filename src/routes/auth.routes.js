import { Router } from "express";
import {
  authenticateWithGoogle,
  requestLoginOtp,
  requestSignupOtp,
  verifyLoginOtp,
  verifySignupOtp,
  verifyUserToken,
} from "../services/userAuth.service.js";

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

router.post(
  "/signup/request-otp",
  asyncHandler(async (req, res) => {
    try {
      const data = await requestSignupOtp(req, {
        fullName: req.body?.fullName,
        phoneE164: req.body?.phoneE164,
        email: req.body?.email,
      });
      res.json({
        success: true,
        message: "Verification code sent",
        data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to send verification code",
      });
    }
  }),
);

router.post(
  "/signup/verify-otp",
  asyncHandler(async (req, res) => {
    try {
      const data = await verifySignupOtp(req, {
        email: req.body?.email,
        code: req.body?.code,
      });
      res.json({
        success: true,
        message: "Account created",
        data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to verify code",
      });
    }
  }),
);

router.post(
  "/login/request-otp",
  asyncHandler(async (req, res) => {
    try {
      const data = await requestLoginOtp(req, { email: req.body?.email });
      res.json({
        success: true,
        message: "Login code sent",
        data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to send login code",
      });
    }
  }),
);

router.post(
  "/login/verify-otp",
  asyncHandler(async (req, res) => {
    try {
      const data = await verifyLoginOtp(req, {
        email: req.body?.email,
        code: req.body?.code,
      });
      res.json({
        success: true,
        message: "Signed in",
        data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to verify login code",
      });
    }
  }),
);

router.post(
  "/google",
  asyncHandler(async (req, res) => {
    try {
      const data = await authenticateWithGoogle(req, {
        idToken: req.body?.idToken,
        fullName: req.body?.fullName,
        phoneE164: req.body?.phoneE164,
      });
      res.json({
        success: true,
        message: "Signed in with Google",
        data,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Google sign-in failed",
        code: error.code || undefined,
      });
    }
  }),
);

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const token = getBearerToken(req);
    const user = await verifyUserToken(token);
    if (!user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    res.json({ success: true, data: user });
  }),
);

export default router;
