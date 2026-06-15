import { Router } from "express";
import healthRoutes from "./health.routes.js";
import requestIntroRoutes from "./requestIntro.routes.js";
import expertReviewRoutes from "./expertReview.routes.js";
import assessmentRoutes from "./assessment.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/request-intro", requestIntroRoutes);
router.use("/expert-review", expertReviewRoutes);
router.use("/assessments", assessmentRoutes);

export default router;
