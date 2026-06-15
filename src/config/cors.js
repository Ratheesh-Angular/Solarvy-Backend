const DEFAULT_ORIGINS = [
  "https://solarvy.net",
  "https://www.solarvy.net",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function normalizeOrigin(origin) {
  return origin.trim().replace(/\/$/, "");
}

export function getAllowedOrigins() {
  const fromEnv = process.env.FRONTEND_URL;

  if (!fromEnv) {
    return DEFAULT_ORIGINS;
  }

  const origins = fromEnv
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  return [...new Set([...origins, ...DEFAULT_ORIGINS])];
}

export function createCorsOptions() {
  const allowedOrigins = getAllowedOrigins();
  const isProduction = process.env.NODE_ENV === "production";

  return {
    origin(origin, callback) {
      const normalizedOrigin = origin ? normalizeOrigin(origin) : null;

      // Allow health checks, curl, Postman, and same-server requests (no Origin header)
      if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
        callback(null, true);
        return;
      }

      if (isProduction) {
        console.warn(`CORS blocked request from origin: ${normalizedOrigin}`);
      }

      callback(new Error(`CORS blocked for origin: ${normalizedOrigin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    exposedHeaders: ["Content-Length"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  };
}
