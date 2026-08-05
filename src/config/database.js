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

  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [BILL_ANALYZER_SETTING_KEY, DEFAULT_BILL_ANALYZER_SYSTEM_PROMPT],
  );
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
  console.log("PostgreSQL database connected");
}

export async function disconnectDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("PostgreSQL database disconnected");
  }
}
