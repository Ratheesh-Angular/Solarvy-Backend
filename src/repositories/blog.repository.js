import { getPool } from "../config/database.js";
import { slugify } from "../services/blog.service.js";

const LIST_COLUMNS = `
  b.id, b.slug, b.title, b.excerpt, b.featured_image_path, b.featured_image_alt,
  b.category, b.tags, b.author_name, b.status, b.published_at, b.meta_title,
  b.meta_description, b.og_image_path, b.reading_time_minutes, b.created_at, b.updated_at
`;

export function mapBlogRow(row, { includeContent = false } = {}) {
  if (!row) return null;
  const blog = {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    featuredImagePath: row.featured_image_path,
    featuredImageAlt: row.featured_image_alt,
    category: row.category,
    tags: row.tags ?? [],
    authorName: row.author_name,
    status: row.status,
    publishedAt: row.published_at,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    ogImagePath: row.og_image_path,
    readingTimeMinutes: row.reading_time_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeContent) blog.contentHtml = row.content_html;
  if (row.views != null) blog.views = Number(row.views);
  if (row.unique_visitors != null) blog.uniqueVisitors = Number(row.unique_visitors);
  return blog;
}

function pagination(query, defaultLimit = 9) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(query.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

export async function listPublishedBlogs(query = {}) {
  const { page, limit, offset } = pagination(query);
  const where = [`b.status = 'published'`];
  const params = [];

  const category = String(query.category || "").trim();
  if (category) {
    params.push(category);
    where.push(`LOWER(b.category) = LOWER($${params.length})`);
  }

  const search = String(query.q || "").trim();
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(
      `(b.title ILIKE $${i} OR b.excerpt ILIKE $${i} OR b.category ILIKE $${i}
        OR array_to_string(b.tags, ' ') ILIKE $${i})`,
    );
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const pool = getPool();
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM blogs b ${whereSql}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await pool.query(
    `SELECT ${LIST_COLUMNS}
     FROM blogs b
     ${whereSql}
     ORDER BY b.published_at DESC NULLS LAST, b.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return {
    items: rows.rows.map((r) => mapBlogRow(r)),
    page,
    limit,
    total: countRes.rows[0].count,
  };
}

export async function listPublishedCategories() {
  const result = await getPool().query(
    `SELECT category, COUNT(*)::int AS count
     FROM blogs
     WHERE status = 'published' AND category <> ''
     GROUP BY category
     ORDER BY count DESC, category ASC`,
  );
  return result.rows.map((r) => ({ name: r.category, count: r.count }));
}

export async function getPublishedBlogBySlug(slug) {
  const result = await getPool().query(
    `SELECT b.* FROM blogs b WHERE b.slug = $1 AND b.status = 'published'`,
    [slug],
  );
  return mapBlogRow(result.rows[0], { includeContent: true });
}

export async function getRelatedBlogs(blog, limit = 3) {
  const result = await getPool().query(
    `SELECT ${LIST_COLUMNS},
            (CASE WHEN LOWER(b.category) = LOWER($2) AND $2 <> '' THEN 2 ELSE 0 END
             + COALESCE(array_length(ARRAY(SELECT UNNEST(b.tags) INTERSECT SELECT UNNEST($3::text[])), 1), 0)
            ) AS score
     FROM blogs b
     WHERE b.status = 'published' AND b.id <> $1
     ORDER BY score DESC, b.published_at DESC NULLS LAST
     LIMIT $4`,
    [blog.id, blog.category || "", blog.tags || [], limit],
  );
  return result.rows.map((r) => mapBlogRow(r));
}

export async function getAdjacentBlogs(blog) {
  const pool = getPool();
  const [prevRes, nextRes] = await Promise.all([
    pool.query(
      `SELECT id, slug, title FROM blogs
       WHERE status = 'published' AND id <> $1
         AND (published_at, id) < ($2::timestamptz, $1)
       ORDER BY published_at DESC, id DESC
       LIMIT 1`,
      [blog.id, blog.publishedAt],
    ),
    pool.query(
      `SELECT id, slug, title FROM blogs
       WHERE status = 'published' AND id <> $1
         AND (published_at, id) > ($2::timestamptz, $1)
       ORDER BY published_at ASC, id ASC
       LIMIT 1`,
      [blog.id, blog.publishedAt],
    ),
  ]);
  return {
    previous: prevRes.rows[0] ?? null,
    next: nextRes.rows[0] ?? null,
  };
}

export async function getPopularPublishedBlogs(limit = 5) {
  const result = await getPool().query(
    `SELECT ${LIST_COLUMNS},
            COUNT(v.id)::int AS views,
            COUNT(DISTINCT v.visitor_key)::int AS unique_visitors
     FROM blogs b
     LEFT JOIN blog_views v ON v.blog_id = b.id
     WHERE b.status = 'published'
     GROUP BY b.id
     ORDER BY views DESC, b.published_at DESC NULLS LAST
     LIMIT $1`,
    [Math.min(20, Math.max(1, Number(limit) || 5))],
  );
  return result.rows.map((r) => mapBlogRow(r));
}

export async function listPublishedFeed() {
  const result = await getPool().query(
    `SELECT b.*
     FROM blogs b
     WHERE b.status = 'published'
     ORDER BY b.published_at DESC NULLS LAST, b.id DESC`,
  );
  return result.rows.map((r) => mapBlogRow(r, { includeContent: true }));
}

export async function listAdminBlogs(query = {}) {
  const { page, limit, offset } = pagination(query, 20);
  const where = [];
  const params = [];

  const status = String(query.status || "").trim();
  if (status === "draft" || status === "published") {
    params.push(status);
    where.push(`b.status = $${params.length}`);
  }

  const search = String(query.q || "").trim();
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(b.title ILIKE $${i} OR b.slug ILIKE $${i} OR b.category ILIKE $${i})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const pool = getPool();
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS count FROM blogs b ${whereSql}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await pool.query(
    `SELECT ${LIST_COLUMNS},
            COALESCE(s.views, 0)::int AS views,
            COALESCE(s.unique_visitors, 0)::int AS unique_visitors
     FROM blogs b
     LEFT JOIN (
       SELECT blog_id, COUNT(*) AS views, COUNT(DISTINCT visitor_key) AS unique_visitors
       FROM blog_views
       GROUP BY blog_id
     ) s ON s.blog_id = b.id
     ${whereSql}
     ORDER BY b.updated_at DESC, b.id DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return {
    items: rows.rows.map((r) => mapBlogRow(r)),
    page,
    limit,
    total: countRes.rows[0].count,
  };
}

export async function getBlogById(id) {
  const result = await getPool().query(`SELECT * FROM blogs WHERE id = $1`, [id]);
  return mapBlogRow(result.rows[0], { includeContent: true });
}

async function ensureUniqueSlug(baseSlug, excludeId = null) {
  const base = slugify(baseSlug) || "post";
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const result = await getPool().query(
      `SELECT 1 FROM blogs WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)`,
      [candidate, excludeId],
    );
    if (result.rowCount === 0) return candidate;
    candidate = `${base.slice(0, 170)}-${suffix}`;
    suffix += 1;
  }
}

const COLUMN_MAP = {
  title: "title",
  excerpt: "excerpt",
  contentHtml: "content_html",
  featuredImagePath: "featured_image_path",
  featuredImageAlt: "featured_image_alt",
  category: "category",
  tags: "tags",
  authorName: "author_name",
  status: "status",
  metaTitle: "meta_title",
  metaDescription: "meta_description",
  ogImagePath: "og_image_path",
  readingTimeMinutes: "reading_time_minutes",
};

export async function createBlog(data) {
  const slug = await ensureUniqueSlug(data.slug || data.title);
  const columns = ["slug"];
  const values = [slug];

  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (data[key] !== undefined) {
      columns.push(column);
      values.push(data[key]);
    }
  }

  const publishedAtSql = data.status === "published" ? ", published_at" : "";
  const publishedAtValue = data.status === "published" ? ", NOW()" : "";
  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");

  const result = await getPool().query(
    `INSERT INTO blogs (${columns.join(", ")}${publishedAtSql}, created_at, updated_at)
     VALUES (${placeholders}${publishedAtValue}, NOW(), NOW())
     RETURNING *`,
    values,
  );
  return mapBlogRow(result.rows[0], { includeContent: true });
}

export async function updateBlog(id, data) {
  const sets = [];
  const values = [];

  if (data.slug !== undefined) {
    const slug = await ensureUniqueSlug(data.slug || data.title || "post", id);
    values.push(slug);
    sets.push(`slug = $${values.length}`);
  }

  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (data[key] !== undefined) {
      values.push(data[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }

  if (data.status === "published") {
    sets.push(`published_at = COALESCE(published_at, NOW())`);
  }
  sets.push(`updated_at = NOW()`);

  values.push(id);
  const result = await getPool().query(
    `UPDATE blogs SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`,
    values,
  );
  return mapBlogRow(result.rows[0], { includeContent: true });
}

export async function deleteBlog(id) {
  const result = await getPool().query(
    `DELETE FROM blogs WHERE id = $1 RETURNING id, featured_image_path, og_image_path`,
    [id],
  );
  return result.rows[0] ?? null;
}
