import { Router } from "express";
import { getPool } from "../config/database.js";

const router = Router();

// Lightweight liveness probe for EC2 / ALB (no database check)
router.get("/live", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "solarvy-api",
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe — confirms API and database are reachable
router.get("/", async (_req, res) => {
  let database = "disconnected";

  try {
    await getPool().query("SELECT 1");
    database = "connected";
  } catch {
    database = "disconnected";
  }

  const isReady = database === "connected";

  res.status(isReady ? 200 : 503).json({
    status: isReady ? "ok" : "degraded",
    service: "solarvy-api",
    environment: process.env.NODE_ENV || "development",
    database,
    apiUrl: process.env.API_URL || null,
    timestamp: new Date().toISOString(),
  });
});

export default router;
