import "dotenv/config";
import express from "express";
import { startTelegramBot } from "./telegram.js";
import { whatsappWebhook } from "./whatsapp.js";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.post("/whatsapp/webhook", whatsappWebhook);
app.get("/health", (_, res) =>
  res.json({
    status: "ok",
    service: "arthsathi-bot",
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    whatsapp: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  })
);

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => console.log(`[Bot] Running on port ${PORT}`));

startTelegramBot();
