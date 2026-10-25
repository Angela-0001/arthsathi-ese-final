import { Bot } from "grammy";
import axios from "axios";
import FormData from "form-data";
import { sendToBackend } from "./gateway.js";
import { translate, detectLanguage } from "./translate.js";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const WEBAPP_URL  = process.env.WEBAPP_URL  || "http://localhost:3000";

// ── Multilingual menus (fully pre-translated, no API call needed) ──────────
function getMainMenu(lang = "hi") {
  const menus = {
    hi: `\u{1F64F} *\u0928\u092E\u0938\u094D\u0924\u0947! ArthSathi \u092E\u0947\u0902 \u0906\u092A\u0915\u093E \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948*\n\n\u0915\u0943\u092A\u092F\u093E \u091A\u0941\u0928\u0947\u0902:\n1\uFE0F\u20E3 *\u0938\u0930\u0915\u093E\u0930\u0940 \u092F\u094B\u091C\u0928\u093E\u090F\u0901*\n2\uFE0F\u20E3 *\u092C\u0940\u092E\u093E \u092A\u0949\u0932\u093F\u0938\u0940*\n3\uFE0F\u20E3 *\u0935\u093F\u0924\u094D\u0924\u0940\u092F \u0930\u094B\u0921\u092E\u0948\u092A*\n4\uFE0F\u20E3 *\u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u0914\u0930 \u091C\u094B\u0916\u093F\u092E \u091C\u093E\u0902\u091A*\n5\uFE0F\u20E3 *\u092E\u0947\u0930\u093E \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932*\n\n\u{1F4CE} \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u0932\u093F\u0902\u0915 \u0915\u0930\u0947\u0902:\n*/link <\u092B\u093C\u094B\u0928 \u0928\u0902\u092C\u0930>*\n\u{1F310} ${WEBAPP_URL}`,
    en: `\u{1F64F} *Welcome to ArthSathi!*\n\nPlease select:\n1\uFE0F\u20E3 *Government Schemes*\n2\uFE0F\u20E3 *Insurance Policies*\n3\uFE0F\u20E3 *Financial Roadmap*\n4\uFE0F\u20E3 *Document Analysis & Risk Check*\n5\uFE0F\u20E3 *My Profile*\n\n\u{1F4CE} Link your profile:\n*/link <phone number>*\n\u{1F310} ${WEBAPP_URL}`,
    mr: `\u{1F64F} *\u0928\u092E\u0938\u094D\u0915\u093E\u0930! ArthSathi \u092E\u0927\u094D\u092F\u0947 \u0906\u092A\u0932\u0947 \u0938\u094D\u0935\u093E\u0917\u0924 \u0906\u0939\u0947*\n\n\u0915\u0943\u092A\u092F\u093E \u0928\u093F\u0935\u0921\u093E:\n1\uFE0F\u20E3 *\u0938\u0930\u0915\u093E\u0930\u0940 \u092F\u094B\u091C\u0928\u093E*\n2\uFE0F\u20E3 *\u0935\u093F\u092E\u093E \u092A\u0949\u0932\u093F\u0938\u0940*\n3\uFE0F\u20E3 *\u0906\u0930\u094D\u0925\u093F\u0915 \u0930\u094B\u0921\u092E\u0945\u092A*\n4\uFE0F\u20E3 *\u0926\u0938\u094D\u0924\u090F\u0935\u091C \u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u0906\u0923\u093F \u091C\u094B\u0916\u0940\u092E \u0924\u092A\u093E\u0938\u0923\u0940*\n5\uFE0F\u20E3 *\u092E\u093C\u093E\u0930\u093E \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932*\n\n\u{1F4CE} \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u0932\u093F\u0902\u0915 \u0915\u0930\u093E:\n*/link <\u092B\u094B\u0928 \u0928\u0902\u092C\u0930>*\n\u{1F310} ${WEBAPP_URL}`,
  };
  return menus[lang] || menus.en;
}

function getLangPrompt() {
  return `\u{1F64F} *\u0928\u092E\u0938\u094D\u0924\u0947! Welcome to ArthSathi*\n\n\u{1F310} *\u092D\u093E\u0937\u093E \u091A\u0941\u0928\u0947\u0902 / Select language / \u092D\u093E\u0937\u093E \u0928\u093F\u0935\u0921\u093E:*\n\n\u{1F1EE}\u{1F1F3} Type *HI* for \u0939\u093F\u0902\u0926\u0940 (Hindi)\n\u{1F1EC}\u{1F1E7} Type *EN* for English\n\u{1F1EE}\u{1F1F3} Type *MR* for \u092E\u0930\u093E\u0920\u0940 (Marathi)`;
}

// ── Severity label translations ────────────────────────────────────────────
const SEVERITY = {
  hi: { high: "\u0909\u0902\u091A\u093E \u091C\u094B\u0916\u093F\u092E", medium: "\u092E\u0927\u094D\u092F\u092E \u091C\u094B\u0916\u093F\u092E", low: "\u0915\u092E \u091C\u094B\u0916\u093F\u092E" },
  en: { high: "High Risk", medium: "Medium Risk", low: "Low Risk" },
  mr: { high: "\u0909\u091A\u094D\u091A \u091C\u094B\u0916\u0940\u092E", medium: "\u092E\u0927\u094D\u092F\u092E \u091C\u094B\u0916\u0940\u092E", low: "\u0915\u092E\u0940 \u091C\u094B\u0916\u0940\u092E" },
};

const UI = {
  hi: {
    analyzing:    "\u{1F4C4} \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u0915\u0940 \u091C\u093E\u0902\u091A \u0939\u094B \u0930\u0939\u0940 \u0939\u0948...",
    summary:      "\u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u0938\u093E\u0930\u093E\u0902\u0936",
    detected:     "\u092E\u093F\u0932\u0940 \u0939\u0941\u0908 \u091C\u094B\u0916\u093F\u092E \u0916\u0902\u0921\u0947\u0902:",
    no_risk:      "\u2705 \u0915\u094B\u0908 \u091C\u094B\u0916\u093F\u092E\u092D\u0930\u0940 \u0916\u0902\u0921 \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u0940\u0964",
    doc_error:    "\u274C \u0926\u0938\u094D\u0924\u093E\u0935\u0947\u091C\u093C \u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E\u0964 \u0915\u0943\u092A\u092F\u093E \u0938\u094D\u092A\u0937\u094D\u091F \u092B\u093C\u094B\u091F\u094B \u092D\u0947\u091C\u0947\u0902\u0964",
    voice_proc:   "\u{1F3D9}\uFE0F \u0906\u092A\u0915\u093E \u0935\u0949\u092F\u0938 \u0938\u0902\u0926\u0947\u0936 \u092A\u094D\u0930\u0938\u0902\u0938\u094D\u0915\u0930\u0923 \u0939\u094B \u0930\u0939\u093E \u0939\u0948...",
    link_usage:   "\u{1F4F1} \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u0932\u093F\u0902\u0915 \u0915\u0930\u0928\u0947 \u0915\u0947 \u0932\u093F\u090F:\n*/link 9876543210*",
    linked:       "\u2705 \u0932\u093F\u0902\u0915 \u0939\u094B \u0917\u092F\u093E! \u0906\u092A\u0915\u0940 \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u091C\u0941\u0921\u093C \u0917\u0908\u0964",
    not_found:    "\u274C \u0907\u0938 \u0928\u0902\u092C\u0930 \u0938\u0947 \u0915\u094B\u0908 \u0916\u093E\u0924\u093E \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u093E\u0964",
    server_err:   "\u274C \u0938\u0930\u094D\u0935\u0930 \u0924\u094D\u0930\u0941\u091F\u093F\u0964 \u092A\u0941\u0928\u0903 \u092A\u094D\u0930\u092F\u093E\u0938 \u0915\u0930\u0947\u0902\u0964",
  },
  en: {
    analyzing:    "\u{1F4C4} Analyzing document for risky clauses...",
    summary:      "Analysis Summary",
    detected:     "Detected Risk Clauses:",
    no_risk:      "\u2705 No risky clauses detected.",
    doc_error:    "\u274C Could not analyze document. Please send a clearer image.",
    voice_proc:   "\u{1F3D9}\uFE0F Processing your voice message...",
    link_usage:   "\u{1F4F1} To link your profile:\n*/link 9876543210*",
    linked:       "\u2705 Linked! Your profile is now connected.",
    not_found:    "\u274C No account found for that number.",
    server_err:   "\u274C Server error. Please try again.",
  },
  mr: {
    analyzing:    "\u{1F4C4} \u0926\u0938\u094D\u0924\u090F\u0935\u091C \u0924\u092A\u093E\u0938\u0923\u0940 \u0938\u0941\u0930\u0942 \u0906\u0939\u0947...",
    summary:      "\u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u0938\u093E\u0930\u093E\u0902\u0936",
    detected:     "\u0906\u0922\u0933\u0932\u0947\u0932\u0947 \u091C\u094B\u0916\u0940\u092E \u0915\u094D\u0932\u0949\u091C:",
    no_risk:      "\u2705 \u0915\u094B\u0923\u0924\u0947\u0939\u0940 \u091C\u094B\u0916\u0940\u092E \u0915\u094D\u0932\u0949\u091C \u0906\u0922\u0933\u0932\u0947 \u0928\u093E\u0939\u0940\u0924.",
    doc_error:    "\u274C \u0926\u0938\u094D\u0924\u090F\u0935\u091C \u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923 \u0936\u0915\u094D\u092F \u0928\u093E\u0939\u0940. \u0938\u094D\u092A\u0937\u094D\u091F \u092B\u094B\u091F\u094B \u092A\u093E\u0920\u0935\u093E.",
    voice_proc:   "\u{1F3D9}\uFE0F \u0906\u092A\u0932\u093E \u0935\u0949\u0907\u0938 \u0938\u0902\u0926\u0947\u0936 \u092A\u094D\u0930\u0915\u094D\u0930\u093F\u092F\u093E \u0915\u0930\u0924 \u0906\u0939\u0947...",
    link_usage:   "\u{1F4F1} \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u0932\u093F\u0902\u0915 \u0915\u0930\u0923\u094D\u092F\u093E\u0938\u093E\u0920\u0940:\n*/link 9876543210*",
    linked:       "\u2705 \u0932\u093F\u0902\u0915 \u0906\u0939\u0947! \u0924\u0941\u092E\u091A\u0940 \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u091C\u094B\u0921\u0932\u0940.",
    not_found:    "\u274C \u092F\u093E \u0928\u0902\u092C\u0930\u0938\u093E\u0920\u0940 \u0916\u093E\u0924\u0947 \u0906\u0922\u0933\u0932\u0947 \u0928\u093E\u0939\u0940.",
    server_err:   "\u274C \u0938\u0930\u094D\u0935\u0930 \u0924\u094D\u0930\u0941\u091F\u0940. \u092A\u0941\u0928\u094D\u0939\u093E \u092A\u094D\u0930\u092F\u0924\u094D\u0928 \u0915\u0930\u093E.",
  },
};

function t(lang, key) {
  return (UI[lang] || UI.en)[key] || (UI.en)[key] || key;
}

// Escape Markdown special chars in dynamic text to prevent Telegram parse errors
function escapeMd(text) {
  if (!text) return "";
  return String(text).replace(/[*_`\[\]]/g, "\\$&");
}

// ── Bot setup ─────────────────────────────────────────────────────────────
export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.log("[Telegram] No BOT_TOKEN set. Skipping."); return; }

  const bot = new Bot(token);
  const userLanguages = new Map(); // userId -> 'hi'|'en'|'mr'

  // /start
  bot.command("start", async (ctx) => {
    const userId = ctx.from.id;
    userLanguages.delete(userId); // force language reselection

    const payload = ctx.message.text.split(" ")[1];
    if (payload?.startsWith("link_")) {
      const phone = payload.replace("link_", "").replace(/\D/g, "").slice(-10);
      if (phone.length >= 10) {
        try {
          const resp = await axios.post(`${BACKEND_URL}/api/auth/link-telegram`, {
            phone, telegram_id: String(userId),
          });
          const name = resp.data.name ? `, ${resp.data.name}` : "";
          await ctx.reply(`\u2705 Account linked${name}!\n\n${getLangPrompt()}`, { parse_mode: "Markdown" });
          return;
        } catch {}
      }
    }
    await ctx.reply(getLangPrompt(), { parse_mode: "Markdown" });
  });

  // /link
  bot.command("link", async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    const parts = ctx.message.text.trim().split(/\s+/);
    const phone = parts[1];
    if (!phone) {
      return ctx.reply(t(lang, "link_usage"), { parse_mode: "Markdown" });
    }
    const cleanPhone = phone.replace(/\D/g, "").slice(-10);
    try {
      const resp = await axios.post(`${BACKEND_URL}/api/auth/link-telegram`, {
        phone: cleanPhone, telegram_id: String(ctx.from.id),
      });
      const name = resp.data.name ? `, ${resp.data.name}` : "";
      await ctx.reply(`${t(lang, "linked")}${name}\n\n${getMainMenu(lang)}`, { parse_mode: "Markdown" });
    } catch (err) {
      if (err.response?.status === 404) {
        await ctx.reply(`${t(lang, "not_found")}\n\n\u{1F310} ${WEBAPP_URL}/login`, { parse_mode: "Markdown" });
      } else {
        await ctx.reply(t(lang, "server_err"));
      }
    }
  });

  // /schemes /insurance /roadmap commands
  bot.command("schemes", async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    await ctx.reply(await translate("Fetching eligible schemes...", lang));
    const result = await sendToBackend({ user_id: String(ctx.from.id), channel: "telegram", intent: "scheme_match", detected_language: lang });
    await ctx.reply(result.text_response || await translate("No schemes found. Complete your profile on the web app first.", lang));
  });
  bot.command("insurance", async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    await ctx.reply(await translate("Fetching insurance recommendations...", lang));
    const result = await sendToBackend({ user_id: String(ctx.from.id), channel: "telegram", intent: "insurance_recommend", detected_language: lang });
    await ctx.reply(result.text_response || `\u{1F6E1}\uFE0F ${WEBAPP_URL}/insurance`);
  });
  bot.command("roadmap", async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    await ctx.reply(await translate("Building your financial roadmap...", lang));
    const result = await sendToBackend({ user_id: String(ctx.from.id), channel: "telegram", intent: "financial_roadmap", detected_language: lang });
    await ctx.reply(result.text_response || await translate("Could not generate roadmap. Complete your profile first.", lang), { parse_mode: "Markdown" });
  });

  bot.command("profile", async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    const result = await sendToBackend({ user_id: String(ctx.from.id), channel: "telegram", intent: "profile", detected_language: lang });
    await ctx.reply(result.text_response || await translate("Could not fetch profile.", lang), { parse_mode: "Markdown" });
  });

  bot.command("language", async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const langCode = parts[1]?.toLowerCase();
    const valid = { hi: "Hindi / हिंदी", en: "English", mr: "Marathi / मराठी" };
    if (valid[langCode]) {
      userLanguages.set(ctx.from.id, langCode);
      // Try to update the user's preferred_language in the DB
      try {
        const dbUserId = await (async () => {
          const resp = await axios.get(`${BACKEND_URL}/api/users`, { params: { telegram_id: String(ctx.from.id) }, timeout: 8000 });
          const users = resp.data?.data || [];
          return users.length ? String(users[0].id) : null;
        })();
        if (dbUserId) {
          await axios.put(`${BACKEND_URL}/api/users/${dbUserId}`, { preferred_language: langCode }, { timeout: 8000 });
        }
      } catch {}
      await ctx.reply(`✅ ${await translate("Language set to", langCode)} ${valid[langCode]}\n\n${getMainMenu(langCode)}`, { parse_mode: "Markdown" });
    } else {
      await ctx.reply(`${getLangPrompt()}\n\nUsage: /language hi | /language en | /language mr`, { parse_mode: "Markdown" });
    }
  });

  // Voice
  bot.on("message:voice", async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    await ctx.reply(t(lang, "voice_proc"));
    const file = await ctx.getFile();
    const result = await sendToBackend({
      user_id: String(ctx.from.id), channel: "telegram",
      audio_url: `https://api.telegram.org/file/bot${token}/${file.file_path}`,
      detected_language: lang,
    });
    await ctx.reply(result.text_response || await translate("Sorry, could not process audio.", lang));
  });

  // Photo / Document -> risk analysis (fully translated)
  bot.on(["message:photo", "message:document"], async (ctx) => {
    const lang = userLanguages.get(ctx.from.id) || "hi";
    await ctx.reply(t(lang, "analyzing"));
    try {
      let fileId, contentType, filename;
      if (ctx.message.photo) {
        fileId      = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        contentType = "image/jpeg";
        filename    = "photo.jpg";
      } else {
        fileId      = ctx.message.document.file_id;
        contentType = ctx.message.document.mime_type || "application/octet-stream";
        filename    = ctx.message.document.file_name || "document";
      }

      const fileInfoResp = await axios.get(
        `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, { timeout: 10000 }
      );
      const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfoResp.data.result.file_path}`;
      const downloadResp = await axios.get(fileUrl, { responseType: "arraybuffer", timeout: 30000 });

      const form = new FormData();
      form.append("file", Buffer.from(downloadResp.data), { filename, contentType });

      const resp = await axios.post(
        `${BACKEND_URL}/api/documents/analyze?lang=${lang}`,
        form,
        { headers: form.getHeaders(), timeout: 90000 }
      );

      const data  = resp.data;
      const flags = data.risk_flags || [];
      const high   = flags.filter(f => (f.severity || f.risk_level) === "high").length;
      const medium = flags.filter(f => (f.severity || f.risk_level) === "medium").length;
      const low    = flags.filter(f => (f.severity || f.risk_level) === "low").length;

      const sevLabels = SEVERITY[lang] || SEVERITY.en;
      let reply = `\u{1F4CB} *${t(lang, "summary")}*\n${escapeMd(data.summary)}\n`;
      reply    += `\n\u{1F534} ${sevLabels.high}: ${high}  \u{1F7E1} ${sevLabels.medium}: ${medium}  \u{1F535} ${sevLabels.low}: ${low}\n`;

      if (flags.length > 0) {
        reply += `\n*${t(lang, "detected")}*\n`;
        for (const f of flags.slice(0, 6)) {
          const level = f.severity || f.risk_level || "medium";
          const emoji = level === "high" ? "\u{1F534}" : level === "medium" ? "\u{1F7E1}" : "\u{1F535}";
          const label = sevLabels[level] || level;
          // explanation is already in English from Python; translate it
          const explanation = await translate(f.explanation || f.context || "", lang);
          reply += `\n${emoji} *${label}*\n${escapeMd(explanation)}\n`;
        }
      } else {
        reply += `\n${t(lang, "no_risk")}`;
      }

      await ctx.reply(reply, { parse_mode: "Markdown" });

    } catch (err) {
      console.error("[Telegram] Document error:", err.response?.data || err.message);
      console.error("[Telegram] Document error details:", {
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data,
        message: err.message,
        code: err.code,
      });
      await ctx.reply(t(lang, "doc_error"));
    }
  });

  // Plain text
  bot.on("message:text", async (ctx) => {
    const text      = ctx.message.text.trim();
    const textUpper = text.toUpperCase();
    const userId    = ctx.from.id;
    let userLang    = userLanguages.get(userId);

    // Language selection
    if (["HI", "EN", "MR"].includes(textUpper)) {
      userLang = textUpper === "HI" ? "hi" : textUpper === "EN" ? "en" : "mr";
      userLanguages.set(userId, userLang);
      return ctx.reply(getMainMenu(userLang), { parse_mode: "Markdown" });
    }

    // No language set yet
    if (!userLang) {
      return ctx.reply(getLangPrompt(), { parse_mode: "Markdown" });
    }

    if (text === "1") {
      await ctx.reply(await translate("Fetching eligible government schemes...", userLang));
      const result = await sendToBackend({ user_id: String(userId), channel: "telegram", intent: "scheme_match", detected_language: userLang });
      return ctx.reply(result.text_response || await translate("No schemes found. Complete your profile on the web app first.", userLang));
    }
    if (text === "2") {
      await ctx.reply(await translate("Fetching insurance recommendations...", userLang));
      const result = await sendToBackend({ user_id: String(userId), channel: "telegram", intent: "insurance_recommend", detected_language: userLang });
      return ctx.reply(result.text_response || await translate(`Visit the web app: ${WEBAPP_URL}/insurance`, userLang));
    }
    if (text === "3") {
      await ctx.reply(await translate("Building your financial roadmap...", userLang));
      const result = await sendToBackend({ user_id: String(userId), channel: "telegram", intent: "financial_roadmap", detected_language: userLang });
      return ctx.reply(result.text_response || await translate("Could not generate roadmap. Complete your profile first.", userLang));
    }
    if (text === "4") {
      return ctx.reply(await translate("Please send a photo or PDF of any document (loan agreement, insurance policy, rental deed, etc). I will explain it in plain language and flag any risky clauses.", userLang));
    }
    if (text === "5") {
      const result = await sendToBackend({ user_id: String(userId), channel: "telegram", intent: "profile", detected_language: userLang });
      return ctx.reply(result.text_response || getMainMenu(userLang), { parse_mode: "Markdown" });
    }

    // General
    const result = await sendToBackend({ user_id: String(userId), channel: "telegram", raw_text: text, detected_language: userLang });
    await ctx.reply(result.text_response || getMainMenu(userLang), { parse_mode: "Markdown" });
  });

  bot.catch((err) => console.error("[Telegram] Error:", err));
  bot.start();
  console.log("[Telegram] Bot started");
}