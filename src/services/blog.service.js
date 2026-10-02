import sanitizeHtml from "sanitize-html";

export const BLOG_STATUSES = ["draft", "published"];

const WORDS_PER_MINUTE = 220;

const SANITIZE_OPTIONS = {
  allowedTags: [
    "h2",
    "h3",
    "h4",
    "p",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "mark",
    "sub",
    "sup",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "figure",
    "figcaption",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "span",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "title"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
    "*": ["style"],
  },
  allowedStyles: {
    "*": {
      "text-align": [/^(left|right|center|justify)$/],
    },
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: { img: ["http", "https"] },
  transformTags: {
    h1: "h2",
    a: (tagName, attribs) => {
      const href = attribs.href || "";
      const isExternal = /^https?:\/\//i.test(href) && !/solarvy\.net/i.test(href);
      return {
        tagName,
        attribs: isExternal
          ? { ...attribs, target: "_blank", rel: "noopener noreferrer" }
          : attribs,
      };
    },
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, loading: "lazy" },
    }),
  },
};

export function sanitizeBlogHtml(html) {
  return sanitizeHtml(String(html || ""), SANITIZE_OPTIONS);
}

const HTML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** Plain text from HTML (for excerpts and word counts); block boundaries become spaces. */
export function stripHtml(html) {
  const spaced = String(html || "").replace(/<\/(p|h[1-6]|li|blockquote|pre|td|th|tr|figcaption)>|<br\s*\/?>/gi, "$& ");
  return sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => HTML_ENTITIES[name])
    .replace(/\s+/g, " ")
    .trim();
}

export function calculateReadingTime(html) {
  const words = stripHtml(html).split(" ").filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

export function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseTags(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(",");
  const seen = new Set();
  const tags = [];
  for (const raw of list) {
    const tag = cleanText(raw, 60);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 15) break;
  }
  return tags;
}

function cleanUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url.slice(0, 1000);
  return "";
}

/**
 * Validate and normalize an admin blog payload.
 * @returns {{ error?: string, data?: object }}
 */
export function parseBlogPayload(body = {}, { partial = false } = {}) {
  const data = {};

  if (!partial || body.title !== undefined) {
    const title = cleanText(body.title, 300);
    if (!title) return { error: "Title is required" };
    data.title = title;
  }

  if (body.slug !== undefined) {
    const slug = slugify(body.slug);
    if (body.slug && !slug) return { error: "Slug is invalid" };
    data.slug = slug;
  }

  if (body.excerpt !== undefined) data.excerpt = cleanText(body.excerpt, 600);
  if (body.contentHtml !== undefined) {
    data.contentHtml = sanitizeBlogHtml(body.contentHtml);
    data.readingTimeMinutes = calculateReadingTime(data.contentHtml);
  }
  if (body.featuredImagePath !== undefined) {
    data.featuredImagePath = cleanUrl(body.featuredImagePath);
  }
  if (body.featuredImageAlt !== undefined) {
    data.featuredImageAlt = cleanText(body.featuredImageAlt, 300);
  }
  if (body.category !== undefined) data.category = cleanText(body.category, 120);
  if (body.tags !== undefined) data.tags = parseTags(body.tags);
  if (body.authorName !== undefined) {
    data.authorName = cleanText(body.authorName, 160) || "SolarVy Team";
  }
  if (body.metaTitle !== undefined) data.metaTitle = cleanText(body.metaTitle, 300);
  if (body.metaDescription !== undefined) {
    data.metaDescription = cleanText(body.metaDescription, 500);
  }
  if (body.ogImagePath !== undefined) data.ogImagePath = cleanUrl(body.ogImagePath);

  if (body.status !== undefined) {
    const status = String(body.status).toLowerCase();
    if (!BLOG_STATUSES.includes(status)) {
      return { error: "Status must be draft or published" };
    }
    data.status = status;
  }

  if (!partial && !data.excerpt && data.contentHtml) {
    data.excerpt = stripHtml(data.contentHtml).slice(0, 220);
  }

  return { data };
}
