import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { createCorsOptions, getAllowedOrigins } from "./config/cors.js";
import { getServerConfig, isProduction, validateEnv } from "./config/env.js";
import apiRoutes from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

validateEnv();

const app = express();
const corsOptions = createCorsOptions();
const { port, host, apiUrl } = getServerConfig();

// Required when running behind Nginx or an AWS ALB on EC2
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  helmet({
    // API serves JSON to a SPA on a different origin (S3 / CloudFront)
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  }),
);

// CORS must run before routes so OPTIONS preflight is handled correctly
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

if (!isProduction()) {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

app.get("/", (_req, res) => {
  res.json({
    message: "Solarvy API",
    environment: process.env.NODE_ENV || "development",
    docs: "/api/health",
    apiUrl,
  });
});

app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function startServer() {
  await connectDatabase();

  const server = app.listen(port, host, () => {
    console.log(`Solarvy API listening on ${host}:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`CORS allowed origins: ${getAllowedOrigins().join(", ")}`);
    if (apiUrl) {
      console.log(`Public API URL: ${apiUrl}`);
    }
  });

  const shutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);

    const forceExit = setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    server.close(async () => {
      clearTimeout(forceExit);
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
