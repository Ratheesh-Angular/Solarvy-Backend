import { Router } from "express";
import multer from "multer";
import path from "path";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { loginAdmin } from "../services/adminAuth.service.js";
import {
  BILL_ANALYZER_SETTING_KEY,
  DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT,
  withBillAnalyzerContextPreamble,
} from "../config/billAnalyzerDefaults.js";
import {
  DEFAULT_QUICK_SNAPSHOT_RECOMMENDATION_SYSTEM_PROMPT,
  DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
  QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
  RECOMMENDATION_SETTING_KEY,
  withRecommendationContextPreamble,
} from "../config/recommendationDefaults.js";
import {
  CHATBOT_SETTING_KEY,
  DEFAULT_CHATBOT_SYSTEM_PROMPT,
} from "../config/chatbotDefaults.js";
import {
  getSetting,
  upsertSetting,
} from "../repositories/appSettings.repository.js";
import {
  createFaq,
  deleteFaq,
  getFaqById,
  listFaqs,
  updateFaq,
} from "../repositories/chatbot.repository.js";
import {
  getTemplateDownloadFileName,
  getTemplateDownloadPath,
  getTemplateInfo,
  replaceTemplate,
} from "../services/excelTemplate.service.js";
import {
  getAnalyticsOverview,
  getRecentActivity,
  listVisitors,
  getVisitorDetail,
  listAssessments,
  listRequestIntros,
  listExpertReviews,
  listQuoteUploads,
  getExpertReviewById,
} from "../repositories/adminAnalytics.repository.js";
import { getQuoteUploadById } from "../repositories/quoteUpload.repository.js";
import { resolveStoredPath } from "../services/fileStorage.service.js";
import {
  formatAssessmentId,
  parseAssessmentIdParam,
} from "../utils/assessmentId.js";
import { getAssessmentById } from "../repositories/assessment.repository.js";
import { isUuid } from "../utils/requestMeta.js";

const router = Router();

function formatUserDisplayName(userNumber) {
  if (userNumber == null || !Number.isFinite(Number(userNumber))) return null;
  return `user_${String(userNumber).padStart(2, "0")}`;
}

function mapVisitorRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userNumber: row.user_number ?? null,
    displayName: formatUserDisplayName(row.user_number),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    lastUserAgent: row.last_user_agent,
    lastCity: row.last_city,
    lastRegion: row.last_region,
    lastCountry: row.last_country,
    createdAt: row.created_at,
    assessmentCount: row.assessment_count ?? undefined,
  };
}

function mapAssessmentRow(row) {
  return {
    id: formatAssessmentId(row.id),
    numericId: row.id,
    draftId: row.draft_id,
    formData: row.form_data,
    results: row.results,
    visitorId: row.visitor_id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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

router.get("/analytics/overview", requireAdmin, async (req, res, next) => {
  try {
    const data = await getAnalyticsOverview({
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/analytics/recent", requireAdmin, async (req, res, next) => {
  try {
    const items = await getRecentActivity({ limit: req.query.limit });
    res.json({
      success: true,
      data: {
        items: items.map((row) => ({
          id: row.id,
          visitorId: row.visitor_id,
          sessionId: row.session_id,
          eventType: row.event_type,
          path: row.path,
          entityType: row.entity_type,
          entityId: row.entity_id,
          metadata: row.metadata,
          ip: row.ip,
          createdAt: row.created_at,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/visitors", requireAdmin, async (req, res, next) => {
  try {
    const data = await listVisitors(req.query);
    res.json({
      success: true,
      data: {
        ...data,
        items: data.items.map(mapVisitorRow),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/visitors/:id", requireAdmin, async (req, res, next) => {
  try {
    const detail = await getVisitorDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ success: false, message: "Visitor not found" });
      return;
    }

    res.json({
      success: true,
      data: {
        visitor: mapVisitorRow(detail.visitor),
        sessions: detail.sessions.map((s) => ({
          id: s.id,
          visitorId: s.visitor_id,
          startedAt: s.started_at,
          lastSeenAt: s.last_seen_at,
          ip: s.ip,
          userAgent: s.user_agent,
          landingPath: s.landing_path,
          referrer: s.referrer,
        })),
        timeline: detail.timeline.map((e) => ({
          id: e.id,
          visitorId: e.visitor_id,
          sessionId: e.session_id,
          eventType: e.event_type,
          path: e.path,
          entityType: e.entity_type,
          entityId: e.entity_id,
          metadata: e.metadata,
          ip: e.ip,
          createdAt: e.created_at,
        })),
        assessments: detail.assessments.map(mapAssessmentRow),
        requestIntros: detail.requestIntros,
        expertReviews: detail.expertReviews,
        quoteUploads: detail.quoteUploads,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/assessments", requireAdmin, async (req, res, next) => {
  try {
    const data = await listAssessments(req.query);
    res.json({
      success: true,
      data: {
        ...data,
        items: data.items.map(mapAssessmentRow),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/assessments/:id", requireAdmin, async (req, res, next) => {
  try {
    const assessmentId = parseAssessmentIdParam(req.params.id);
    if (!Number.isFinite(assessmentId)) {
      res.status(400).json({ success: false, message: "Invalid assessment id" });
      return;
    }

    const assessment = await getAssessmentById(assessmentId);
    if (!assessment) {
      res.status(404).json({ success: false, message: "Assessment not found" });
      return;
    }

    const visitorId = String(req.query.visitorId || "").trim();
    if (visitorId) {
      if (!isUuid(visitorId) || assessment.visitor_id !== visitorId) {
        res.status(404).json({ success: false, message: "Assessment not found" });
        return;
      }
    }

    res.json({
      success: true,
      data: mapAssessmentRow(assessment),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/request-intros", requireAdmin, async (req, res, next) => {
  try {
    const data = await listRequestIntros(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/expert-reviews", requireAdmin, async (req, res, next) => {
  try {
    const data = await listExpertReviews(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/quote-uploads", requireAdmin, async (req, res, next) => {
  try {
    const data = await listQuoteUploads(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/expert-reviews/:id/file",
  requireAdmin,
  async (req, res, next) => {
    try {
      const row = await getExpertReviewById(Number(req.params.id));
      if (!row?.storage_path) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }
      const absolute = resolveStoredPath(row.storage_path);
      if (!absolute) {
        res.status(404).json({ success: false, message: "File not found" });
        return;
      }
      res.download(
        absolute,
        row.attachment_file_name || path.basename(absolute),
        (error) => {
          if (error) next(error);
        },
      );
    } catch (error) {
      next(error);
    }
  },
);

router.get("/quote-uploads/:id/file", requireAdmin, async (req, res, next) => {
  try {
    const row = await getQuoteUploadById(Number(req.params.id));
    if (!row?.storage_path) {
      res.status(404).json({ success: false, message: "File not found" });
      return;
    }
    const absolute = resolveStoredPath(row.storage_path);
    if (!absolute) {
      res.status(404).json({ success: false, message: "File not found" });
      return;
    }
    res.download(
      absolute,
      row.original_name || path.basename(absolute),
      (error) => {
        if (error) next(error);
      },
    );
  } catch (error) {
    next(error);
  }
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

const RECOMMENDATION_PROMPT_MAX_LEN = 50_000;

router.get("/ai-prompts/recommendation", requireAdmin, async (_req, res, next) => {
  try {
    const row = await getSetting(RECOMMENDATION_SETTING_KEY);
    res.json({
      success: true,
      data: {
        key: RECOMMENDATION_SETTING_KEY,
        value: withRecommendationContextPreamble(
          row?.value ?? DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
        ),
        updatedAt: row?.updatedAt ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/ai-prompts/recommendation", requireAdmin, async (req, res, next) => {
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

    if (value.length > RECOMMENDATION_PROMPT_MAX_LEN) {
      res.status(400).json({
        success: false,
        message: `Prompt must be at most ${RECOMMENDATION_PROMPT_MAX_LEN} characters`,
      });
      return;
    }

    const row = await upsertSetting(RECOMMENDATION_SETTING_KEY, value);
    res.json({
      success: true,
      message: "Recommendation AI prompt updated",
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

router.get(
  "/ai-prompts/quick-snapshot-recommendation",
  requireAdmin,
  async (_req, res, next) => {
    try {
      const row = await getSetting(QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY);
      res.json({
        success: true,
        data: {
          key: QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
          value: withRecommendationContextPreamble(
            row?.value ?? DEFAULT_QUICK_SNAPSHOT_RECOMMENDATION_SYSTEM_PROMPT,
          ),
          updatedAt: row?.updatedAt ?? null,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.put(
  "/ai-prompts/quick-snapshot-recommendation",
  requireAdmin,
  async (req, res, next) => {
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

      if (value.length > RECOMMENDATION_PROMPT_MAX_LEN) {
        res.status(400).json({
          success: false,
          message: `Prompt must be at most ${RECOMMENDATION_PROMPT_MAX_LEN} characters`,
        });
        return;
      }

      const row = await upsertSetting(
        QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
        value,
      );
      res.json({
        success: true,
        message: "Quick Snapshot recommendation AI prompt updated",
        data: {
          key: row.key,
          value: row.value,
          updatedAt: row.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

const CHATBOT_PROMPT_MAX_LEN = 50_000;
const FAQ_TEXT_MAX_LEN = 5_000;

router.get("/ai-prompts/chatbot", requireAdmin, async (_req, res, next) => {
  try {
    const row = await getSetting(CHATBOT_SETTING_KEY);
    res.json({
      success: true,
      data: {
        key: CHATBOT_SETTING_KEY,
        value: row?.value ?? DEFAULT_CHATBOT_SYSTEM_PROMPT,
        updatedAt: row?.updatedAt ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.put("/ai-prompts/chatbot", requireAdmin, async (req, res, next) => {
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

    if (value.length > CHATBOT_PROMPT_MAX_LEN) {
      res.status(400).json({
        success: false,
        message: `Prompt must be at most ${CHATBOT_PROMPT_MAX_LEN} characters`,
      });
      return;
    }

    const row = await upsertSetting(CHATBOT_SETTING_KEY, value);
    res.json({
      success: true,
      message: "Chatbot AI prompt updated",
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

function parseFaqPayload(body, { partial = false } = {}) {
  const question =
    typeof body?.question === "string" ? body.question.trim() : undefined;
  const answer =
    typeof body?.answer === "string" ? body.answer.trim() : undefined;
  const sortOrderRaw = body?.sortOrder;
  const sortOrder =
    sortOrderRaw === undefined || sortOrderRaw === null || sortOrderRaw === ""
      ? undefined
      : Number(sortOrderRaw);
  const isActive =
    typeof body?.isActive === "boolean" ? body.isActive : undefined;

  if (!partial || question !== undefined) {
    if (!question) {
      return { error: "Question is required" };
    }
    if (question.length > FAQ_TEXT_MAX_LEN) {
      return { error: `Question must be at most ${FAQ_TEXT_MAX_LEN} characters` };
    }
  }

  if (!partial || answer !== undefined) {
    if (!answer) {
      return { error: "Answer is required" };
    }
    if (answer.length > FAQ_TEXT_MAX_LEN) {
      return { error: `Answer must be at most ${FAQ_TEXT_MAX_LEN} characters` };
    }
  }

  if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
    return { error: "sortOrder must be a number" };
  }

  return { question, answer, sortOrder, isActive };
}

router.get("/faqs", requireAdmin, async (_req, res, next) => {
  try {
    const faqs = await listFaqs();
    res.json({ success: true, data: faqs });
  } catch (error) {
    next(error);
  }
});

router.post("/faqs", requireAdmin, async (req, res, next) => {
  try {
    const parsed = parseFaqPayload(req.body, { partial: false });
    if (parsed.error) {
      res.status(400).json({ success: false, message: parsed.error });
      return;
    }

    const faq = await createFaq({
      question: parsed.question,
      answer: parsed.answer,
      sortOrder: parsed.sortOrder ?? 0,
      isActive: parsed.isActive ?? true,
    });

    res.status(201).json({
      success: true,
      message: "FAQ created",
      data: faq,
    });
  } catch (error) {
    next(error);
  }
});

router.put("/faqs/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ success: false, message: "Invalid FAQ id" });
      return;
    }

    const existing = await getFaqById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: "FAQ not found" });
      return;
    }

    const parsed = parseFaqPayload(req.body, { partial: true });
    if (parsed.error) {
      res.status(400).json({ success: false, message: parsed.error });
      return;
    }

    const faq = await updateFaq(id, {
      question: parsed.question,
      answer: parsed.answer,
      sortOrder: parsed.sortOrder,
      isActive: parsed.isActive,
    });

    res.json({
      success: true,
      message: "FAQ updated",
      data: faq,
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/faqs/:id", requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ success: false, message: "Invalid FAQ id" });
      return;
    }

    const deleted = await deleteFaq(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: "FAQ not found" });
      return;
    }

    res.json({
      success: true,
      message: "FAQ deleted",
      data: { id: deleted.id },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
