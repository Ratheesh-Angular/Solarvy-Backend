import { Router } from "express";
import healthRoutes from "./health.routes.js";
import requestIntroRoutes from "./requestIntro.routes.js";
import expertReviewRoutes from "./expertReview.routes.js";
import assessmentRoutes from "./assessment.routes.js";
import excelRoutes from "./excel.routes.js";
import billsRoutes from "./bills.routes.js";
import adminRoutes from "./admin.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/request-intro", requestIntroRoutes);
router.use("/expert-review", expertReviewRoutes);
router.use("/assessments", assessmentRoutes);
router.use("/excel", excelRoutes);
router.use("/bills", billsRoutes);
router.use("/admin", adminRoutes);

export default router;
