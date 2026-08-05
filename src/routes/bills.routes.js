import { Router } from "express";
import multer from "multer";
import { analyzeBillDocument } from "../services/billAnalyzer.service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const router = Router();

router.post("/extract", upload.single("bill"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "No bill file uploaded" });
      return;
    }

    const values = await analyzeBillDocument(req.file.buffer, {
      mimeType: req.file.mimetype || "application/octet-stream",
      fileName: req.file.originalname || "bill",
    });

    res.json({
      success: true,
      message: values.lowConfidence
        ? "Bill analyzed with low confidence — please verify values"
        : "Bill processed",
      data: {
        fileName: req.file.originalname,
        ...values,
      },
    });
  } catch (error) {
    if (
      error.message?.includes("OPENAI_API_KEY") ||
      error.message?.includes("Empty bill")
    ) {
      res.status(400).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
});

export default router;
