/**
 * One-off import of blog articles as DRAFTS for review in /admin/blogs.
 *
 * Usage:
 *   node scripts/seed-blogs.js path/to/articles.json            # import
 *   node scripts/seed-blogs.js path/to/articles.json --dry-run  # validate only
 *
 * The JSON file is an array of articles (see scripts/blog-articles.example.json):
 *   title            required
 *   slug             optional, generated from the title
 *   excerpt          optional, generated from the content
 *   contentHtml      article HTML, or
 *   contentFile      path to an HTML file (relative to the JSON file), or
 *   content          plain text; blank lines separate paragraphs
 *   featuredImage    optional local image path (relative to the JSON file), copied to uploads/blog-images
 *   featuredImagePath optional absolute image URL (used when featuredImage is not given)
 *   featuredImageAlt, category, tags (array or comma string), authorName, metaTitle, metaDescription
 *
 * Articles whose slug already exists are skipped, so the script is safe to re-run.
 * Content goes through the same sanitizer as the admin editor. Nothing is published.
 * Set API_URL in .env so uploaded image URLs are public (e.g. https://api.solarvy.net).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { connectDatabase, disconnectDatabase, getPool } from "../src/config/database.js";
import { getServerConfig } from "../src/config/env.js";
import { createBlog } from "../src/repositories/blog.repository.js";
import { parseBlogPayload, slugify } from "../src/services/blog.service.js";
import { saveBlogImage } from "../src/services/fileStorage.service.js";

const IMAGE_MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

async function readText(filePath) {
  return (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainTextToHtml(text) {
  return String(text)
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}

async function resolveContentHtml(article, baseDir) {
  if (article.contentHtml) return String(article.contentHtml);
  if (article.contentFile) return readText(path.resolve(baseDir, article.contentFile));
  if (article.content) return plainTextToHtml(article.content);
  return "";
}

async function importImage(relativePath, baseDir, apiOrigin) {
  const filePath = path.resolve(baseDir, relativePath);
  const mimetype = IMAGE_MIME[path.extname(filePath).toLowerCase()];
  if (!mimetype) throw new Error(`Unsupported image type: ${relativePath}`);
  const buffer = await readFile(filePath);
  if (buffer.length > 5 * 1024 * 1024) throw new Error(`Image larger than 5MB: ${relativePath}`);
  const saved = await saveBlogImage({ buffer, mimetype, size: buffer.length });
  return `${apiOrigin}/api/uploads/${saved.storagePath}`;
}

async function slugExists(slug) {
  const { rows } = await getPool().query(`SELECT 1 FROM blogs WHERE slug = $1`, [slug]);
  return rows.length > 0;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fileArg = args.find((a) => !a.startsWith("--"));

if (!fileArg) {
  console.error("Usage: node scripts/seed-blogs.js path/to/articles.json [--dry-run]");
  process.exit(1);
}

const jsonPath = path.resolve(fileArg);
const baseDir = path.dirname(jsonPath);
const articles = JSON.parse(await readText(jsonPath));
if (!Array.isArray(articles)) {
  console.error("The JSON file must contain an array of articles.");
  process.exit(1);
}

const { apiUrl, port } = getServerConfig();
const apiOrigin = (apiUrl || `http://localhost:${port}`).replace(/\/+$/, "");
if (!apiUrl && !dryRun) {
  console.warn(`API_URL is not set; image URLs will use ${apiOrigin}.`);
}

await connectDatabase();

const summary = { created: 0, skipped: 0, failed: 0 };

try {
  for (const [index, article] of articles.entries()) {
    const label = `#${index + 1} "${article?.title ?? "(untitled)"}"`;
    try {
      const slug = slugify(article.slug || article.title);
      if (!slug) throw new Error("Title or slug is required");
      if (await slugExists(slug)) {
        console.log(`SKIP  ${label}: slug "${slug}" already exists`);
        summary.skipped += 1;
        continue;
      }

      const contentHtml = await resolveContentHtml(article, baseDir);
      const parsed = parseBlogPayload(
        {
          title: article.title,
          slug,
          excerpt: article.excerpt,
          contentHtml,
          featuredImagePath: article.featuredImagePath,
          featuredImageAlt: article.featuredImageAlt,
          category: article.category,
          tags: article.tags,
          authorName: article.authorName,
          metaTitle: article.metaTitle,
          metaDescription: article.metaDescription,
          status: "draft",
        },
        { partial: false },
      );
      if (parsed.error) throw new Error(parsed.error);
      if (!parsed.data.contentHtml) throw new Error("Content is empty after sanitizing");

      if (dryRun) {
        console.log(`OK    ${label}: would create draft /blog/${slug}`);
        summary.created += 1;
        continue;
      }

      if (article.featuredImage) {
        parsed.data.featuredImagePath = await importImage(article.featuredImage, baseDir, apiOrigin);
      }

      const blog = await createBlog(parsed.data);
      console.log(`DRAFT ${label}: id ${blog.id}, /blog/${blog.slug}`);
      summary.created += 1;
    } catch (error) {
      console.error(`FAIL  ${label}: ${error.message}`);
      summary.failed += 1;
    }
  }
} finally {
  await disconnectDatabase();
}

console.log(
  `${dryRun ? "Dry run: " : ""}${summary.created} ${dryRun ? "valid" : "created"}, ` +
    `${summary.skipped} skipped, ${summary.failed} failed.`,
);
if (summary.failed > 0) process.exitCode = 1;
