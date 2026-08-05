import { Router } from "express";
import { getCatalogs } from "../services/excelReader.service.js";
import {
  getLiveSummary,
  getTemplatePrefill,
} from "../services/excelCalculator.service.js";

const router = Router();

router.get("/catalogs", async (_req, res, next) => {
  try {
    const catalogs = await getCatalogs();
    res.json({ success: true, data: catalogs });
  } catch (error) {
    next(error);
  }
});

router.post("/template-prefill", async (req, res, next) => {
  try {
    const { propertyType, template } = req.body;

    if (!propertyType || !template) {
      res.status(400).json({
        success: false,
        message: "propertyType and template are required",
      });
      return;
    }

    const prefill = await getTemplatePrefill(propertyType, template);
    res.json({ success: true, data: prefill });
  } catch (error) {
    next(error);
  }
});

router.post("/live-summary", async (req, res, next) => {
  try {
    const formData = req.body.formData ?? req.body;
    const summary = await getLiveSummary(formData);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

export default router;
