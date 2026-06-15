const REQUIRED_IN_PRODUCTION = ["DATABASE_URL", "FRONTEND_URL"];

export function isProduction() {
  return process.env.NODE_ENV === "production";
}

export function validateEnv() {
  if (!isProduction()) {
    return;
  }

  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for production: ${missing.join(", ")}`,
    );
  }
}

export function getServerConfig() {
  return {
    port: Number(process.env.PORT) || 5000,
    host: process.env.HOST || "0.0.0.0",
    apiUrl: process.env.API_URL?.trim() || null,
  };
}
