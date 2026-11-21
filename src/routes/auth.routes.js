import { Router } from "express";
import multer from "multer";
import {
  authenticateWithGoogle,
  deleteCurrentUserAvatar,
  requestLoginOtp,
  requestSignupOtp,
  updateCurrentUserProfile,
  uploadCurrentUserAvatar,
  verifyLoginOtp,
  verifySignupOtp,
  verifyUserToken,
} from "../services/userAuth.service.js";
import { AVATAR_MAX_BYTES } from "../services/fileStorage.service.js";

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

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter(_req, file, cb) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype || "")) {
      cb(new Error("Only JPG, PNG, or WebP images are accepted"));
      return;
    }
    cb(null, true);
  },
});

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
    const user = await verifyUserToken(token, req);
    if (!user) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    res.json({ success: true, data: user });
  }),
);

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    try {
      const user = await updateCurrentUserProfile(req, {
        fullName: req.body?.fullName,
        phoneE164: req.body?.phoneE164,
        country: req.body?.country,
        region: req.body?.region,
        city: req.body?.city,
      });
      res.json({
        success: true,
        message: "Profile updated",
        data: user,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to update profile",
      });
    }
  }),
);

router.post("/me/avatar", (req, res, next) => {
  avatarUpload.single("avatar")(req, res, async (uploadError) => {
    if (uploadError) {
      const message =
        uploadError.code === "LIMIT_FILE_SIZE"
          ? "Image must be 2MB or smaller"
          : uploadError.message;
      res.status(400).json({ success: false, message });
      return;
    }
    try {
      const user = await uploadCurrentUserAvatar(req, req.file);
      res.json({
        success: true,
        message: "Profile photo updated",
        data: user,
      });
    } catch (error) {
      if (
        /^(No file uploaded|Unsupported image type|Image must be)/.test(
          error.message || "",
        )
      ) {
        res.status(400).json({ success: false, message: error.message });
        return;
      }
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to upload photo",
      });
    }
  });
});

router.delete(
  "/me/avatar",
  asyncHandler(async (req, res) => {
    try {
      const user = await deleteCurrentUserAvatar(req);
      res.json({
        success: true,
        message: "Profile photo removed",
        data: user,
      });
    } catch (error) {
      const status = error.status || 500;
      res.status(status).json({
        success: false,
        message: error.message || "Unable to remove photo",
      });
    }
  }),
);

export default router;
