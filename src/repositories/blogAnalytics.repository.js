import { getPool } from "../config/database.js";

export const VIEW_DEDUPE_MINUTES = 30;

function parseDateBound(value, endOfDay = false) {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

function resolveRange({ from, to } = {}) {
  const fromIso =
    parseDateBound(from) || new Date(Date.now() - 30 * 86400000).toISOString();
  const toIso = parseDateBound(to, true) || new Date().toISOString();
  return { fromIso, toIso };
}

const REFERRER_HOST_SQL = `
  CASE
    WHEN referrer = '' THEN 'Direct'
    ELSE COALESCE(NULLIF(substring(referrer from '^[a-zA-Z]+://(?:www\\.)?([^/:?#]+)'), ''), 'Other')
  END
`;

/**
 * Insert a view unless the same visitor viewed this blog within the dedupe window.
 * @returns {Promise<boolean>} true when a new view row was recorded
 */
export async function recordBlogView({
  blogId,
  visitorId,
  sessionId,
  visitorKey,
  referrer,
  ip,
  userAgent,
}) {
  const result = await getPool().query(
    `INSERT INTO blog_views (blog_id, visitor_id, session_id, visitor_key, referrer, ip, user_agent)
     SELECT $1::int, $2::uuid, $3::uuid, $4::varchar, $5::text, $6::varchar, $7::text
     WHERE NOT EXISTS (
       SELECT 1 FROM blog_views
       WHERE blog_id = $1::int
         AND visitor_key = $4::varchar
         AND created_at > NOW() - ($8::int * INTERVAL '1 minute')
     )
     RETURNING id`,
    [
      blogId,
      visitorId,
      sessionId,
      visitorKey,
      referrer,
      ip,
      userAgent,
      VIEW_DEDUPE_MINUTES,
    ],
  );
  return result.rowCount > 0;
}

export async function getBlogAnalyticsOverview(range = {}) {
  const { fromIso, toIso } = resolveRange(range);
  const spanMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
  const prevFromIso = new Date(new Date(fromIso).getTime() - spanMs).toISOString();
  const pool = getPool();

  const [totalsRes, prevTotalsRes, postsRes, dailyRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT visitor_key)::int AS unique_visitors,
              COUNT(DISTINCT blog_id)::int AS posts_viewed
       FROM blog_views
       WHERE created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT visitor_key)::int AS unique_visitors
       FROM blog_views
       WHERE created_at >= $1 AND created_at < $2`,
      [prevFromIso, fromIso],
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'published')::int AS published,
              COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts
       FROM blogs`,
    ),
    pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(COUNT(v.id), 0)::int AS views,
              COALESCE(COUNT(DISTINCT v.visitor_key), 0)::int AS unique_visitors
       FROM generate_series($1::timestamptz::date, $2::timestamptz::date, INTERVAL '1 day') AS d(day)
       LEFT JOIN blog_views v
         ON DATE(v.created_at) = d.day::date
        AND v.created_at >= $1 AND v.created_at <= $2
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [fromIso, toIso],
    ),
  ]);

  const totals = totalsRes.rows[0];
  const published = postsRes.rows[0].published;

  return {
    from: fromIso,
    to: toIso,
    kpis: {
      totalViews: totals.views,
      uniqueVisitors: totals.unique_visitors,
      postsViewed: totals.posts_viewed,
      publishedPosts: published,
      draftPosts: postsRes.rows[0].drafts,
      avgViewsPerPost:
        published > 0 ? Math.round((totals.views / published) * 10) / 10 : 0,
      previousViews: prevTotalsRes.rows[0].views,
      previousUniqueVisitors: prevTotalsRes.rows[0].unique_visitors,
    },
    daily: dailyRes.rows.map((r) => ({
      day: r.day,
      views: r.views,
      uniqueVisitors: r.unique_visitors,
    })),
  };
}

export async function getPopularBlogsAnalytics({ from, to, limit } = {}) {
  const { fromIso, toIso } = resolveRange({ from, to });
  const result = await getPool().query(
    `SELECT b.id, b.slug, b.title, b.category, b.status, b.published_at,
            COUNT(v.id)::int AS views,
            COUNT(DISTINCT v.visitor_key)::int AS unique_visitors,
            MAX(v.created_at) AS last_viewed_at
     FROM blogs b
     JOIN blog_views v ON v.blog_id = b.id
     WHERE v.created_at >= $1 AND v.created_at <= $2
     GROUP BY b.id
     ORDER BY views DESC, unique_visitors DESC
     LIMIT $3`,
    [fromIso, toIso, Math.min(50, Math.max(1, Number(limit) || 10))],
  );

  return {
    from: fromIso,
    to: toIso,
    items: result.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: r.category,
      status: r.status,
      publishedAt: r.published_at,
      views: r.views,
      uniqueVisitors: r.unique_visitors,
      lastViewedAt: r.last_viewed_at,
    })),
  };
}

export async function getBlogAnalyticsDetail(blogId, range = {}) {
  const { fromIso, toIso } = resolveRange(range);
  const pool = getPool();

  const [totalsRes, allTimeRes, dailyRes, referrersRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT visitor_key)::int AS unique_visitors
       FROM blog_views
       WHERE blog_id = $1 AND created_at >= $2 AND created_at <= $3`,
      [blogId, fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT visitor_key)::int AS unique_visitors,
              MIN(created_at) AS first_viewed_at,
              MAX(created_at) AS last_viewed_at
       FROM blog_views
       WHERE blog_id = $1`,
      [blogId],
    ),
    pool.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(COUNT(v.id), 0)::int AS views,
              COALESCE(COUNT(DISTINCT v.visitor_key), 0)::int AS unique_visitors
       FROM generate_series($2::timestamptz::date, $3::timestamptz::date, INTERVAL '1 day') AS d(day)
       LEFT JOIN blog_views v
         ON v.blog_id = $1
        AND DATE(v.created_at) = d.day::date
        AND v.created_at >= $2 AND v.created_at <= $3
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [blogId, fromIso, toIso],
    ),
    pool.query(
      `SELECT ${REFERRER_HOST_SQL} AS source, COUNT(*)::int AS views
       FROM blog_views
       WHERE blog_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY source
       ORDER BY views DESC
       LIMIT 10`,
      [blogId, fromIso, toIso],
    ),
  ]);

  const allTime = allTimeRes.rows[0];
  return {
    from: fromIso,
    to: toIso,
    kpis: {
      views: totalsRes.rows[0].views,
      uniqueVisitors: totalsRes.rows[0].unique_visitors,
      allTimeViews: allTime.views,
      allTimeUniqueVisitors: allTime.unique_visitors,
      firstViewedAt: allTime.first_viewed_at,
      lastViewedAt: allTime.last_viewed_at,
    },
    daily: dailyRes.rows.map((r) => ({
      day: r.day,
      views: r.views,
      uniqueVisitors: r.unique_visitors,
    })),
    referrers: referrersRes.rows.map((r) => ({ source: r.source, views: r.views })),
  };
}
