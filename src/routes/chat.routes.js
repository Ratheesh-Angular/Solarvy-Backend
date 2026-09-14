import { Router } from "express";
import { handleChatTurn } from "../services/chatbot.service.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const data = await handleChatTurn(req);
    res.json({
      success: true,
      data,
    });
  } catch (error) {
    if (error?.status) {
      res.status(error.status).json({
        success: false,
        message: error.message || "Chat request failed",
      });
      return;
    }
    next(error);
  }
});

export default router;
