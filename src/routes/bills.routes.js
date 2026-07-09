import { Router } from "express";
import multer from "multer";
import { extractBillValues } from "../services/billExtractor.service.js";

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

    const values = await extractBillValues(req.file.buffer);

    res.json({
      success: true,
      message: "Bill processed",
      data: {
        fileName: req.file.originalname,
        ...values,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
