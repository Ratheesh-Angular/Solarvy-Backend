import { Router } from "express";
import multer from "multer";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { loginAdmin } from "../services/adminAuth.service.js";
import {
  BILL_ANALYZER_SETTING_KEY,
  DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT,
  withBillAnalyzerContextPreamble,
} from "../config/billAnalyzerDefaults.js";
import {
  getSetting,
  upsertSetting,
} from "../repositories/appSettings.repository.js";
import {
  getTemplateDownloadFileName,
  getTemplateDownloadPath,
  getTemplateInfo,
  replaceTemplate,
} from "../services/excelTemplate.service.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.originalname?.toLowerCase().endsWith(".xlsx")) {
      cb(new Error("Only .xlsx files are accepted"));
      return;
    }
    cb(null, true);
  },
});

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    const result = await loginAdmin(username, password);
    res.json({ success: true, data: result });
  } catch (error) {
    if (
      error.message === "Invalid username or password" ||
      error.message === "Username and password are required"
    ) {
      res.status(401).json({ success: false, message: error.message });
      return;
    }
    next(error);
  }
});

router.get("/me", requireAdmin, (req, res) => {
  res.json({ success: true, data: { user: req.admin } });
});

router.get("/excel/template", requireAdmin, (_req, res) => {
  res.json({ success: true, data: getTemplateInfo() });
});

router.get("/excel/template/download", requireAdmin, (req, res, next) => {
  try {
    const templatePath = getTemplateDownloadPath();
    if (!templatePath) {
      res.status(404).json({
        success: false,
        message: "Excel template file is missing on the server.",
      });
      return;
    }

    res.download(
      templatePath,
      getTemplateDownloadFileName(),
      (error) => {
        if (error) next(error);
      },
    );
  } catch (error) {
    next(error);
  }
});

router.post(
  "/excel/template",
  requireAdmin,
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: "No Excel file uploaded. Use form field name 'file'.",
        });
        return;
      }

      const result = await replaceTemplate(
        req.file.buffer,
        req.file.originalname,
      );

      res.json({
        success: true,
        message: "Excel template updated successfully",
        data: result,
      });
    } catch (error) {
      if (
        error.message?.includes("missing required sheet") ||
        error.message?.includes("Only .xlsx") ||
        error.message?.includes("Empty upload") ||
        error.message?.includes("File too large")
      ) {
        res.status(400).json({ success: false, message: error.message });
        return;
      }

      if (error.message?.includes("Close Microsoft Excel")) {
        res.status(409).json({ success: false, message: error.message });
        return;
      }

      next(error);
    }
  },
);

const BILL_PROMPT_MAX_LEN = 50_000;

router.get("/ai-prompts/bill", requireAdmin, async (_req, res, next) => {
  try {
    const row = await getSetting(BILL_ANALYZER_SETTING_KEY);
    res.json({
      success: true,
      data: {
        key: BILL_ANALYZER_SETTING_KEY,
        value: withBillAnalyzerContextPreamble(
          row?.value ?? DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT,
        ),
        updatedAt: row?.updatedAt ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/ai-prompts/bill", requireAdmin, async (req, res, next) => {
  try {
    const value =
      typeof req.body?.value === "string" ? req.body.value.trim() : "";

    if (!value) {
      res.status(400).json({
        success: false,
        message: "Prompt value is required",
      });
      return;
    }

    if (value.length > BILL_PROMPT_MAX_LEN) {
      res.status(400).json({
        success: false,
        message: `Prompt must be at most ${BILL_PROMPT_MAX_LEN} characters`,
      });
      return;
    }

    const row = await upsertSetting(BILL_ANALYZER_SETTING_KEY, value);
    res.json({
      success: true,
      message: "Bill AI prompt updated",
      data: {
        key: row.key,
        value: row.value,
        updatedAt: row.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
