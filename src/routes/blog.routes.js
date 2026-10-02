import { Router } from "express";
import { createHash } from "crypto";
import {
  getAdjacentBlogs,
  getPopularPublishedBlogs,
  getPublishedBlogBySlug,
  getRelatedBlogs,
  listPublishedBlogs,
  listPublishedCategories,
  listPublishedFeed,
} from "../repositories/blog.repository.js";
import { recordBlogView } from "../repositories/blogAnalytics.repository.js";
import { slugify } from "../services/blog.service.js";
import {
  getClientIp,
  getSessionIdFromRequest,
  getUserAgent,
  getVisitorIdFromRequest,
} from "../utils/requestMeta.js";

const router = Router();

const BOT_UA_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|whatsapp\/|headlesschrome|lighthouse|pingdom|curl\/|wget\/|python-requests|axios\/|node-fetch|go-http-client|postmanruntime/i;

function normalizeSlugParam(value) {
  return slugify(decodeURIComponent(String(value || "")));
}

router.get("/", async (req, res, next) => {
  try {
    const [data, categories] = await Promise.all([
      listPublishedBlogs(req.query),
      listPublishedCategories(),
    ]);
    res.json({ success: true, data: { ...data, categories } });
  } catch (error) {
    next(error);
  }
});

router.get("/popular", async (req, res, next) => {
  try {
    const items = await getPopularPublishedBlogs(req.query.limit);
    res.json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
});

router.get("/feed", async (_req, res, next) => {
  try {
    const items = await listPublishedFeed();
    res.json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const slug = normalizeSlugParam(req.params.slug);
    const blog = slug ? await getPublishedBlogBySlug(slug) : null;
    if (!blog) {
      res.status(404).json({ success: false, message: "Article not found" });
      return;
    }

    const [related, adjacent] = await Promise.all([
      getRelatedBlogs(blog, 3),
      getAdjacentBlogs(blog),
    ]);

    res.json({ success: true, data: { blog, related, ...adjacent } });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/view", async (req, res, next) => {
  try {
    const userAgent = getUserAgent(req);
    if (!userAgent || BOT_UA_RE.test(userAgent)) {
      res.json({ success: true, data: { recorded: false } });
      return;
    }

    const slug = normalizeSlugParam(req.params.slug);
    const blog = slug ? await getPublishedBlogBySlug(slug) : null;
    if (!blog) {
      res.status(404).json({ success: false, message: "Article not found" });
      return;
    }

    const ip = getClientIp(req);
    const visitorId = getVisitorIdFromRequest(req);
    const sessionId = getSessionIdFromRequest(req);
    const visitorKey =
      visitorId ||
      `anon:${createHash("sha256").update(`${ip}|${userAgent}`).digest("hex").slice(0, 40)}`;
    const referrer = String(req.body?.referrer || "").slice(0, 1000);

    const recorded = await recordBlogView({
      blogId: blog.id,
      visitorId,
      sessionId,
      visitorKey,
      referrer,
      ip,
      userAgent,
    });

    res.json({ success: true, data: { recorded } });
  } catch (error) {
    next(error);
  }
});

export default router;
