import { getPool } from "../config/database.js";

function parseDateBound(value, endOfDay = false) {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    d.setUTCHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

function pagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export async function getAnalyticsOverview({ from, to } = {}) {
  const pool = getPool();
  const fromIso = parseDateBound(from) || new Date(Date.now() - 30 * 86400000).toISOString();
  const toIso = parseDateBound(to, true) || new Date().toISOString();

  const [
    visitorsRes,
    sessionsRes,
    assessmentStartsRes,
    assessmentCompletesRes,
    requestIntrosRes,
    expertReviewsRes,
    quoteUploadsRes,
    convertingVisitorsRes,
    dailyVisitorsRes,
    dailyEventsRes,
  ] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM visitors
       WHERE last_seen_at >= $1 AND last_seen_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM visitor_sessions
       WHERE started_at >= $1 AND started_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM activity_events
       WHERE event_type = 'assessment_started'
         AND created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM assessments
       WHERE created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM request_intros
       WHERE created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM expert_reviews
       WHERE created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS count
       FROM quote_uploads
       WHERE created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT COUNT(DISTINCT visitor_id)::int AS count
       FROM activity_events
       WHERE visitor_id IS NOT NULL
         AND event_type IN ('assessment_started', 'assessment_completed')
         AND created_at >= $1 AND created_at <= $2`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT DATE(last_seen_at) AS day, COUNT(*)::int AS count
       FROM visitors
       WHERE last_seen_at >= $1 AND last_seen_at <= $2
       GROUP BY DATE(last_seen_at)
       ORDER BY day ASC`,
      [fromIso, toIso],
    ),
    pool.query(
      `SELECT DATE(created_at) AS day,
              COUNT(*) FILTER (WHERE event_type = 'assessment_completed')::int AS assessments,
              COUNT(*) FILTER (WHERE event_type = 'request_intro_submitted')::int AS request_intros,
              COUNT(*) FILTER (WHERE event_type = 'expert_review_submitted')::int AS expert_reviews,
              COUNT(*) FILTER (WHERE event_type = 'quote_upload_submitted')::int AS quote_uploads
       FROM activity_events
       WHERE created_at >= $1 AND created_at <= $2
         AND event_type IN (
           'assessment_completed',
           'request_intro_submitted',
           'expert_review_submitted',
           'quote_upload_submitted'
         )
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [fromIso, toIso],
    ),
  ]);

  const uniqueVisitors = visitorsRes.rows[0].count;
  const convertingVisitors = convertingVisitorsRes.rows[0].count;

  return {
    from: fromIso,
    to: toIso,
    kpis: {
      uniqueVisitors,
      totalSessions: sessionsRes.rows[0].count,
      assessmentStarts: assessmentStartsRes.rows[0].count,
      completedAssessments: assessmentCompletesRes.rows[0].count,
      requestIntros: requestIntrosRes.rows[0].count,
      expertReviews: expertReviewsRes.rows[0].count,
      quoteUploads: quoteUploadsRes.rows[0].count,
      visitorToAssessmentRate:
        uniqueVisitors > 0
          ? Math.round((convertingVisitors / uniqueVisitors) * 1000) / 10
          : 0,
    },
    charts: {
      visitorsByDay: dailyVisitorsRes.rows.map((r) => ({
        day: r.day,
        count: r.count,
      })),
      submissionsByDay: dailyEventsRes.rows.map((r) => ({
        day: r.day,
        assessments: r.assessments,
        requestIntros: r.request_intros,
        expertReviews: r.expert_reviews,
        quoteUploads: r.quote_uploads,
      })),
    },
  };
}

export async function getRecentActivity({ limit = 25 } = {}) {
  const result = await getPool().query(
    `SELECT id, visitor_id, session_id, event_type, path, entity_type, entity_id,
            metadata, ip, created_at
     FROM activity_events
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.min(100, Math.max(1, Number(limit) || 25))],
  );
  return result.rows;
}

export async function listVisitors(query = {}) {
  const { page, limit, offset } = pagination(query);
  const fromIso = parseDateBound(query.from);
  const toIso = parseDateBound(query.to, true);
  const search = String(query.q || "").trim();

  const where = [];
  const params = [];

  if (fromIso) {
    params.push(fromIso);
    where.push(`v.last_seen_at >= $${params.length}`);
  }
  if (toIso) {
    params.push(toIso);
    where.push(`v.last_seen_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(
      `(v.id::text ILIKE $${i}
        OR v.last_ip ILIKE $${i}
        OR v.last_user_agent ILIKE $${i}
        OR v.last_city ILIKE $${i}
        OR v.last_region ILIKE $${i}
        OR v.last_country ILIKE $${i}
        OR ('user_' || lpad(v.user_number::text, 2, '0')) ILIKE $${i}
        OR v.user_number::text ILIKE $${i})`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countRes = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM visitors v ${whereSql}`,
    params,
  );

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(limit, offset);
  const rows = await getPool().query(
    `SELECT v.id, v.user_id, v.user_number, v.first_seen_at, v.last_seen_at,
            v.last_ip, v.last_user_agent, v.last_city, v.last_region, v.last_country,
            v.created_at,
            (SELECT COUNT(*)::int FROM assessments a WHERE a.visitor_id = v.id) AS assessment_count
     FROM visitors v
     ${whereSql}
     ORDER BY v.last_seen_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return {
    items: rows.rows,
    page,
    limit,
    total: countRes.rows[0].count,
  };
}

export async function getVisitorDetail(visitorId) {
  const pool = getPool();
  const visitorRes = await pool.query(
    `SELECT * FROM visitors WHERE id = $1`,
    [visitorId],
  );
  const visitor = visitorRes.rows[0];
  if (!visitor) return null;

  const [sessions, events, assessments, requestIntros, expertReviews, quoteUploads] =
    await Promise.all([
      pool.query(
        `SELECT * FROM visitor_sessions
         WHERE visitor_id = $1
         ORDER BY started_at DESC
         LIMIT 50`,
        [visitorId],
      ),
      pool.query(
        `SELECT * FROM activity_events
         WHERE visitor_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [visitorId],
      ),
      pool.query(
        `SELECT id, draft_id, form_data, results, created_at, updated_at, visitor_id, session_id
         FROM assessments
         WHERE visitor_id = $1
         ORDER BY created_at DESC`,
        [visitorId],
      ),
      pool.query(
        `SELECT * FROM request_intros
         WHERE visitor_id = $1
         ORDER BY created_at DESC`,
        [visitorId],
      ),
      pool.query(
        `SELECT * FROM expert_reviews
         WHERE visitor_id = $1
         ORDER BY created_at DESC`,
        [visitorId],
      ),
      pool.query(
        `SELECT * FROM quote_uploads
         WHERE visitor_id = $1
         ORDER BY created_at DESC`,
        [visitorId],
      ),
    ]);

  return {
    visitor,
    sessions: sessions.rows,
    timeline: events.rows,
    assessments: assessments.rows,
    requestIntros: requestIntros.rows,
    expertReviews: expertReviews.rows,
    quoteUploads: quoteUploads.rows,
  };
}

export async function listAssessments(query = {}) {
  const { page, limit, offset } = pagination(query);
  const fromIso = parseDateBound(query.from);
  const toIso = parseDateBound(query.to, true);
  const search = String(query.q || "").trim();
  const visitorId = String(query.visitorId || "").trim();

  const where = [];
  const params = [];

  if (visitorId) {
    params.push(visitorId);
    where.push(`visitor_id = $${params.length}`);
  }
  if (fromIso) {
    params.push(fromIso);
    where.push(`created_at >= $${params.length}`);
  }
  if (toIso) {
    params.push(toIso);
    where.push(`created_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(id::text ILIKE $${params.length} OR form_data::text ILIKE $${params.length} OR visitor_id::text ILIKE $${params.length})`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM assessments ${whereSql}`,
    params,
  );
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(limit, offset);
  const rows = await getPool().query(
    `SELECT id, draft_id, form_data, results, created_at, updated_at, visitor_id, session_id
     FROM assessments
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return { items: rows.rows, page, limit, total: countRes.rows[0].count };
}

export async function listRequestIntros(query = {}) {
  return listLeadTable("request_intros", query);
}

export async function listExpertReviews(query = {}) {
  return listLeadTable("expert_reviews", query);
}

export async function listQuoteUploads(query = {}) {
  return listLeadTable("quote_uploads", query, {
    searchColumns: ["original_name", "email", "full_name", "visitor_id::text"],
  });
}

async function listLeadTable(table, query = {}, options = {}) {
  const { page, limit, offset } = pagination(query);
  const fromIso = parseDateBound(query.from);
  const toIso = parseDateBound(query.to, true);
  const search = String(query.q || "").trim();
  const visitorId = String(query.visitorId || "").trim();
  const searchColumns =
    options.searchColumns ||
    ["full_name", "email", "phone_number", "visitor_id::text"];

  const where = [];
  const params = [];

  if (visitorId) {
    params.push(visitorId);
    where.push(`visitor_id = $${params.length}`);
  }
  if (fromIso) {
    params.push(fromIso);
    where.push(`created_at >= $${params.length}`);
  }
  if (toIso) {
    params.push(toIso);
    where.push(`created_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(${searchColumns.map((col) => `${col} ILIKE $${params.length}`).join(" OR ")})`,
    );
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRes = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM ${table} ${whereSql}`,
    params,
  );
  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  params.push(limit, offset);
  const rows = await getPool().query(
    `SELECT * FROM ${table}
     ${whereSql}
     ORDER BY created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  return { items: rows.rows, page, limit, total: countRes.rows[0].count };
}

export async function getExpertReviewById(id) {
  const result = await getPool().query(
    `SELECT * FROM expert_reviews WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}
