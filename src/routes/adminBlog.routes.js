import { Router } from "express";
import multer from "multer";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  createBlog,
  deleteBlog,
  getBlogById,
  listAdminBlogs,
  updateBlog,
} from "../repositories/blog.repository.js";
import {
  getBlogAnalyticsDetail,
  getBlogAnalyticsOverview,
  getPopularBlogsAnalytics,
} from "../repositories/blogAnalytics.repository.js";
import { parseBlogPayload } from "../services/blog.service.js";
import { saveBlogImage } from "../services/fileStorage.service.js";
import { getServerConfig } from "../config/env.js";

const router = Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype || "")) {
      cb(new Error("Only JPG, PNG, WebP, or GIF images are accepted"));
      return;
    }
    cb(null, true);
  },
});

function publicApiOrigin(req) {
  const { apiUrl } = getServerConfig();
  if (apiUrl) return apiUrl.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.use(requireAdmin);

router.get("/", async (req, res, next) => {
  try {
    const data = await listAdminBlogs(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.post("/images", (req, res, next) => {
  imageUpload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const message =
        uploadError.code === "LIMIT_FILE_SIZE"
          ? "Image must be 5MB or smaller"
          : uploadError.message;
      res.status(400).json({ success: false, message });
      return;
    }
    try {
      const saved = await saveBlogImage(req.file);
      res.status(201).json({
        success: true,
        data: {
          url: `${publicApiOrigin(req)}/api/uploads/${saved.storagePath}`,
          storagePath: saved.storagePath,
          sizeBytes: saved.sizeBytes,
        },
      });
    } catch (error) {
      if (/^(No file uploaded|Unsupported image type)/.test(error.message)) {
        res.status(400).json({ success: false, message: error.message });
        return;
      }
      next(error);
    }
  });
});

router.get("/analytics/overview", async (req, res, next) => {
  try {
    const data = await getBlogAnalyticsOverview({
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/analytics/popular", async (req, res, next) => {
  try {
    const data = await getPopularBlogsAnalytics({
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/analytics", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid blog id" });
      return;
    }
    const blog = await getBlogById(id);
    if (!blog) {
      res.status(404).json({ success: false, message: "Blog not found" });
      return;
    }
    const analytics = await getBlogAnalyticsDetail(id, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json({
      success: true,
      data: {
        blog: { id: blog.id, slug: blog.slug, title: blog.title, status: blog.status },
        ...analytics,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid blog id" });
      return;
    }
    const blog = await getBlogById(id);
    if (!blog) {
      res.status(404).json({ success: false, message: "Blog not found" });
      return;
    }
    res.json({ success: true, data: blog });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = parseBlogPayload(req.body, { partial: false });
    if (parsed.error) {
      res.status(400).json({ success: false, message: parsed.error });
      return;
    }
    const blog = await createBlog(parsed.data);
    res.status(201).json({ success: true, message: "Blog created", data: blog });
  } catch (error) {
    next(error);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid blog id" });
      return;
    }
    const existing = await getBlogById(id);
    if (!existing) {
      res.status(404).json({ success: false, message: "Blog not found" });
      return;
    }
    const parsed = parseBlogPayload(req.body, { partial: true });
    if (parsed.error) {
      res.status(400).json({ success: false, message: parsed.error });
      return;
    }
    const blog = await updateBlog(id, parsed.data);
    res.json({ success: true, message: "Blog updated", data: blog });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ success: false, message: "Invalid blog id" });
      return;
    }
    const deleted = await deleteBlog(id);
    if (!deleted) {
      res.status(404).json({ success: false, message: "Blog not found" });
      return;
    }
    res.json({ success: true, message: "Blog deleted", data: { id: deleted.id } });
  } catch (error) {
    next(error);
  }
});

export default router;
