import { Router } from "express";
import healthRoutes from "./health.routes.js";
import requestIntroRoutes from "./requestIntro.routes.js";
import expertReviewRoutes from "./expertReview.routes.js";
import assessmentRoutes from "./assessment.routes.js";
import excelRoutes from "./excel.routes.js";
import billsRoutes from "./bills.routes.js";
import adminRoutes from "./admin.routes.js";
import trackingRoutes from "./tracking.routes.js";
import quoteUploadRoutes from "./quoteUpload.routes.js";
import chatRoutes from "./chat.routes.js";
import blogRoutes from "./blog.routes.js";
import adminBlogRoutes from "./adminBlog.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/tracking", trackingRoutes);
router.use("/request-intro", requestIntroRoutes);
router.use("/expert-review", expertReviewRoutes);
router.use("/quote-uploads", quoteUploadRoutes);
router.use("/assessments", assessmentRoutes);
router.use("/excel", excelRoutes);
router.use("/bills", billsRoutes);
router.use("/chat", chatRoutes);
router.use("/blogs", blogRoutes);
router.use("/admin/blogs", adminBlogRoutes);
router.use("/admin", adminRoutes);

export default router;
