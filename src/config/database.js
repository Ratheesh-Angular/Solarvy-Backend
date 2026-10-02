import pg from "pg";

const { Pool } = pg;

let pool = null;

function getPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment variables");
  }

  const config = {
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  // AWS RDS PostgreSQL typically requires SSL (set DATABASE_SSL=false for local dev only)
  if (process.env.DATABASE_SSL !== "false") {
    config.ssl = { rejectUnauthorized: false };
  }

  return config;
}

async function ensureColumn(db, tableName, columnName, columnSql) {
  const check = await db.query(
    `SELECT 1
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2`,
    [tableName, columnName],
  );

  if (check.rowCount === 0) {
    await db.query(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`,
    );
  }
}

async function initSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS request_intros (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      phone_number VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
      project_timeline VARCHAR(100) DEFAULT '',
      additional_notes TEXT DEFAULT '',
      project_summary JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS expert_reviews (
      id SERIAL PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      phone_number VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
      project_location VARCHAR(255) NOT NULL,
      review_type VARCHAR(100) DEFAULT '',
      additional_notes TEXT DEFAULT '',
      attachment_file_name VARCHAR(255) DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS assessment_drafts (
      id SERIAL PRIMARY KEY,
      form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const columnCheck = await db.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'assessments' AND column_name = 'form_data'
  `);

  if (columnCheck.rowCount === 0) {
    await db.query(`DROP TABLE IF EXISTS assessments CASCADE`);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS assessments (
      id SERIAL PRIMARY KEY,
      draft_id INTEGER REFERENCES assessment_drafts(id) ON DELETE SET NULL,
      form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      results JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visitors (
      id UUID PRIMARY KEY,
      user_id UUID NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_ip VARCHAR(64) DEFAULT '',
      last_user_agent TEXT DEFAULT '',
      last_city VARCHAR(120) DEFAULT '',
      last_region VARCHAR(120) DEFAULT '',
      last_country VARCHAR(120) DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id UUID PRIMARY KEY,
      visitor_id UUID NOT NULL REFERENCES visitors(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip VARCHAR(64) DEFAULT '',
      user_agent TEXT DEFAULT '',
      landing_path TEXT DEFAULT '',
      referrer TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id BIGSERIAL PRIMARY KEY,
      visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
      session_id UUID REFERENCES visitor_sessions(id) ON DELETE SET NULL,
      event_type VARCHAR(80) NOT NULL,
      path TEXT DEFAULT '',
      entity_type VARCHAR(80) DEFAULT '',
      entity_id VARCHAR(80) DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ip VARCHAR(64) DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS quote_uploads (
      id SERIAL PRIMARY KEY,
      visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
      session_id UUID REFERENCES visitor_sessions(id) ON DELETE SET NULL,
      assessment_id INTEGER REFERENCES assessments(id) ON DELETE SET NULL,
      full_name VARCHAR(255) DEFAULT '',
      email VARCHAR(255) DEFAULT '',
      phone_number VARCHAR(50) DEFAULT '',
      location VARCHAR(255) DEFAULT '',
      additional_notes TEXT DEFAULT '',
      original_name VARCHAR(255) NOT NULL DEFAULT '',
      stored_name VARCHAR(255) NOT NULL DEFAULT '',
      mime_type VARCHAR(120) DEFAULT '',
      size_bytes INTEGER DEFAULT 0,
      storage_path TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id UUID PRIMARY KEY,
      visitor_id UUID REFERENCES visitors(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS faq_entries (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS blogs (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(200) UNIQUE NOT NULL,
      title VARCHAR(300) NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      featured_image_path TEXT NOT NULL DEFAULT '',
      featured_image_alt VARCHAR(300) NOT NULL DEFAULT '',
      category VARCHAR(120) NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      author_name VARCHAR(160) NOT NULL DEFAULT 'SolarVy Team',
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ NULL,
      meta_title VARCHAR(300) NOT NULL DEFAULT '',
      meta_description TEXT NOT NULL DEFAULT '',
      og_image_path TEXT NOT NULL DEFAULT '',
      reading_time_minutes INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS blog_views (
      id BIGSERIAL PRIMARY KEY,
      blog_id INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      visitor_id UUID NULL,
      session_id UUID NULL,
      visitor_key VARCHAR(128) NOT NULL,
      referrer TEXT NOT NULL DEFAULT '',
      ip VARCHAR(64) NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await ensureColumn(db, "assessment_drafts", "visitor_id", "UUID NULL");
  await ensureColumn(db, "assessment_drafts", "session_id", "UUID NULL");
  await ensureColumn(db, "assessments", "visitor_id", "UUID NULL");
  await ensureColumn(db, "assessments", "session_id", "UUID NULL");
  await ensureColumn(db, "request_intros", "visitor_id", "UUID NULL");
  await ensureColumn(db, "request_intros", "session_id", "UUID NULL");
  await ensureColumn(db, "expert_reviews", "visitor_id", "UUID NULL");
  await ensureColumn(db, "expert_reviews", "session_id", "UUID NULL");
  await ensureColumn(
    db,
    "expert_reviews",
    "stored_file_name",
    "VARCHAR(255) DEFAULT ''",
  );
  await ensureColumn(
    db,
    "expert_reviews",
    "mime_type",
    "VARCHAR(120) DEFAULT ''",
  );
  await ensureColumn(db, "expert_reviews", "size_bytes", "INTEGER DEFAULT 0");
  await ensureColumn(db, "expert_reviews", "storage_path", "TEXT DEFAULT ''");
  await ensureColumn(db, "quote_uploads", "location", "VARCHAR(255) DEFAULT ''");
  await ensureColumn(
    db,
    "quote_uploads",
    "additional_notes",
    "TEXT DEFAULT ''",
  );
  await ensureColumn(db, "visitors", "user_number", "INTEGER");

  // Backfill sequential user_number for existing visitors, then enforce uniqueness.
  await db.query(`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
      FROM visitors
      WHERE user_number IS NULL
    )
    UPDATE visitors v
    SET user_number = ranked.rn
    FROM ranked
    WHERE v.id = ranked.id
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_user_number
      ON visitors (user_number)
      WHERE user_number IS NOT NULL
  `);

  await db.query(`
    CREATE SEQUENCE IF NOT EXISTS visitors_user_number_seq
  `);

  const maxNumRes = await db.query(
    `SELECT COALESCE(MAX(user_number), 0)::int AS max FROM visitors`,
  );
  const maxNum = maxNumRes.rows[0]?.max ?? 0;
  if (maxNum === 0) {
    await db.query(`SELECT setval('visitors_user_number_seq', 1, false)`);
  } else {
    await db.query(`SELECT setval('visitors_user_number_seq', $1, true)`, [
      maxNum,
    ]);
  }

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors (last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor ON visitor_sessions (visitor_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_events_visitor ON activity_events (visitor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_events_type_created ON activity_events (event_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activity_events_created ON activity_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assessments_visitor ON assessments (visitor_id);
    CREATE INDEX IF NOT EXISTS idx_assessments_created ON assessments (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_intros_visitor ON request_intros (visitor_id);
    CREATE INDEX IF NOT EXISTS idx_request_intros_email ON request_intros (email);
    CREATE INDEX IF NOT EXISTS idx_request_intros_created ON request_intros (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_expert_reviews_visitor ON expert_reviews (visitor_id);
    CREATE INDEX IF NOT EXISTS idx_expert_reviews_email ON expert_reviews (email);
    CREATE INDEX IF NOT EXISTS idx_expert_reviews_created ON expert_reviews (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quote_uploads_visitor ON quote_uploads (visitor_id);
    CREATE INDEX IF NOT EXISTS idx_quote_uploads_created ON quote_uploads (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_faq_entries_active_sort ON faq_entries (is_active, sort_order ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_blogs_status_published ON blogs (status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blog_views_blog_created ON blog_views (blog_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blog_views_blog_visitor ON blog_views (blog_id, visitor_key, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_blog_views_created ON blog_views (created_at DESC);
  `);
}

async function seedAdminUser() {
  const { seedAdminUser: seed } = await import("../services/adminAuth.service.js");
  await seed();
}

async function seedAppSettings() {
  const {
    BILL_ANALYZER_SETTING_KEY,
    DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT,
  } = await import("./billAnalyzerDefaults.js");
  const {
    RECOMMENDATION_SETTING_KEY,
    DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
    QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
    DEFAULT_QUICK_SNAPSHOT_RECOMMENDATION_SYSTEM_PROMPT,
  } = await import("./recommendationDefaults.js");
  const {
    CHATBOT_SETTING_KEY,
    DEFAULT_CHATBOT_SYSTEM_PROMPT,
  } = await import("./chatbotDefaults.js");

  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW()), ($3, $4, NOW()), ($5, $6, NOW()), ($7, $8, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [
      BILL_ANALYZER_SETTING_KEY,
      DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT,
      RECOMMENDATION_SETTING_KEY,
      DEFAULT_RECOMMENDATION_SYSTEM_PROMPT,
      QUICK_SNAPSHOT_RECOMMENDATION_SETTING_KEY,
      DEFAULT_QUICK_SNAPSHOT_RECOMMENDATION_SYSTEM_PROMPT,
      CHATBOT_SETTING_KEY,
      DEFAULT_CHATBOT_SYSTEM_PROMPT,
    ],
  );
}

async function seedFaqEntries() {
  const countRes = await pool.query(`SELECT COUNT(*)::int AS count FROM faq_entries`);
  if ((countRes.rows[0]?.count ?? 0) > 0) return;

  const starters = [
    {
      question: "What is Solarvy?",
      answer:
        "Solarvy helps homes and businesses estimate solar size, battery storage, diesel reduction, savings, and payback before speaking to installers or committing money.",
      sortOrder: 10,
    },
    {
      question: "How does the Solarvy assessment work?",
      answer:
        "You answer a guided set of questions about your property, power setup, and energy use (including optional bill upload). Solarvy then estimates system size, hybrid options, and likely outcomes so you can decide next steps with more clarity.",
      sortOrder: 20,
    },
    {
      question: "Who is Solarvy for?",
      answer:
        "Solarvy is for homeowners and businesses that want clearer solar sizing and savings estimates before talking to installers — especially where grid reliability, diesel backup, or hybrid systems matter.",
      sortOrder: 30,
    },
    {
      question: "Does Solarvy install solar panels?",
      answer:
        "No. Solarvy provides decision support and can help you request introductions to matched installers. It is not an installer and does not replace a full on-site survey.",
      sortOrder: 40,
    },
    {
      question: "What should I do next?",
      answer:
        "Start with the free assessment for a tailored estimate. You can also review How it works, Sample results, or request an expert review / installer introduction from the site.",
      sortOrder: 50,
    },
  ];

  for (const item of starters) {
    await pool.query(
      `INSERT INTO faq_entries (question, answer, sort_order, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, TRUE, NOW(), NOW())`,
      [item.question, item.answer, item.sortOrder],
    );
  }
}

export function getPool() {
  if (!pool) {
    throw new Error("Database pool is not initialized");
  }
  return pool;
}

export async function connectDatabase() {
  pool = new Pool(getPoolConfig());
  await pool.query("SELECT 1");
  await initSchema(pool);
  await seedAdminUser();
  await seedAppSettings();
  await seedFaqEntries();
  console.log("PostgreSQL database connected");
}

export async function disconnectDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("PostgreSQL database disconnected");
  }
}
