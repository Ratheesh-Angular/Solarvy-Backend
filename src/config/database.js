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

    CREATE TABLE IF NOT EXISTS assessments (
      id SERIAL PRIMARY KEY,
      country VARCHAR(100) NOT NULL,
      state VARCHAR(100) DEFAULT '',
      property_type VARCHAR(100) DEFAULT '',
      power_source VARCHAR(100) DEFAULT '',
      input_method VARCHAR(100) DEFAULT '',
      objective VARCHAR(100) DEFAULT '',
      category VARCHAR(100) DEFAULT '',
      load_rows JSONB DEFAULT '[]'::jsonb,
      results JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
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
  console.log("PostgreSQL database connected");
}

export async function disconnectDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("PostgreSQL database disconnected");
  }
}
