/**
 * ArthSathi — Telegram Bot Route
 *
 * POST /api/telegram/webhook  — receives updates from Telegram
 *
 * Env vars required:
 *   TELEGRAM_BOT_TOKEN  — bot token from @BotFather
 *   TELEGRAM_WEBHOOK_URL — public HTTPS URL for this server (used by setWebhook)
 */

const express = require('express');
const { Telegraf } = require('telegraf');
const { query } = require('../db');
const router = express.Router();

// ─── Bot instance (lazy — only if token is configured) ───────────────────────
let bot = null;

function getBot() {
  if (!bot && process.env.TELEGRAM_BOT_TOKEN) {
    bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
    setupHandlers(bot);
  }
  return bot;
}

// ─── Language detection (hi, mr, en only) ────────────────────────────────────
function detectLanguage(text) {
  if (!text) return 'en';
  const devanagari = /[\u0900-\u097F]/;
  if (devanagari.test(text)) {
    const marathiWords = /आहे|आहेत|मला|तुम्ही|नाही|कृपया|विचारा|सांगा/;
    return marathiWords.test(text) ? 'mr' : 'hi';
  }
  return 'en';
}

// ─── Fetch schemes: personalized if user found, generic fallback ─────────────
async function fetchSchemesForUser(telegramId, lang, limit = 5) {
  // Only try personalized recs if Groq is configured
  if (process.env.GROQ_API_KEY) {
    try {
      const userResult = await query(
        'SELECT id, age, occupation, state FROM users WHERE telegram_id = $1',
        [String(telegramId)]
      );
      if (userResult.rows.length > 0 && userResult.rows[0].occupation) {
        const userId = userResult.rows[0].id;
        const { getRelevantSchemes } = require('../services/groqRecommendation');
        return await getRelevantSchemes(userId, limit);
      }
    } catch (e) {
      console.warn('[Telegram] Personalized recs error:', e.message);
    }
  }
  // Generic fallback
  return fetchTopSchemes(lang, limit);
}

// ─── Fetch top schemes from DB ────────────────────────────────────────────────
async function fetchTopSchemes(lang, limit = 5) {
  try {
    const result = await query(
      `SELECT name, description, benefit_type, benefit_amount_max, application_url
       FROM schemes
       WHERE is_active = TRUE
       ORDER BY last_scraped_at DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  } catch (err) {
    console.error('[Telegram] DB error fetching schemes:', err.message);
    return [];
  }
}

// ─── Format scheme list for display ──────────────────────────────────────────
function formatSchemes(schemes, lang) {
  if (!schemes || schemes.length === 0) {
    const noData = { hi: 'कोई योजना नहीं मिली।', mr: 'कोणतीही योजना सापडली नाही.', en: 'No schemes found.' };
    return noData[lang] || noData.en;
  }
  return schemes
    .map((s, i) => {
      const name = typeof s.name === 'object' && s.name !== null
        ? (s.name[lang] || s.name.en || s.name.hi || Object.values(s.name)[0] || 'Scheme')
        : (s.name || 'Scheme');
      const desc = typeof s.description === 'object' && s.description !== null
        ? (s.description[lang] || s.description.en || s.description.hi || '')
        : (s.description || '');
      const benefit = s.benefit_amount_max ? ` | Max: ₹${s.benefit_amount_max}` : '';
      const url = s.application_url ? `\n🔗 ${s.application_url}` : '';
      return `${i + 1}. *${name}*${benefit}\n${desc.slice(0, 200)}${url}`;
    })
    .join('\n\n');
}

// ─── Bot command and message handlers ────────────────────────────────────────
function setupHandlers(b) {
  b.start((ctx) => {
    ctx.reply(
      '🙏 *नमस्ते! मैं आर्थसाथी हूं।*\n\n' +
      'मैं आपको सरकारी योजनाओं और बीमा के बारे में जानकारी दे सकता हूं।\n\n' +
      'Hello! I am ArthSathi. I can help you with government schemes and insurance.\n\n' +
      'Commands:\n' +
      '/start — Welcome message\n' +
      '/help — How to use\n' +
      '/schemes — Top government schemes\n' +
      '/lang hi|en|mr — Switch language',
      { parse_mode: 'Markdown' }
    );
  });

  b.help((ctx) => {
    ctx.reply(
      '*ArthSathi Help*\n\n' +
      '📌 Send any message in Hindi, English, or Marathi to ask about schemes or insurance.\n\n' +
      '• /schemes — Browse top government schemes\n' +
      '• /lang hi — Switch to Hindi\n' +
      '• /lang en — Switch to English\n' +
      '• /lang mr — Switch to Marathi\n\n' +
      '_Example: "PM Kisan scheme" or "कृषि योजना"_',
      { parse_mode: 'Markdown' }
    );
  });

  b.command('schemes', async (ctx) => {
    const telegramId = ctx.from?.id;
    const schemes = await fetchSchemesForUser(telegramId, 'en', 5);
    const msg = formatSchemes(schemes, 'en');
    ctx.reply('🏛️ *Top Government Schemes*\n\n' + msg, { parse_mode: 'Markdown' });
  });

  b.command('lang', (ctx) => {
    const parts = ctx.message.text.split(' ');
    const lang = parts[1]?.toLowerCase();
    const valid = { hi: 'Hindi / हिंदी', en: 'English', mr: 'Marathi / मराठी' };
    if (valid[lang]) {
      ctx.reply(`✅ Language set to ${valid[lang]}. Send your question now.`);
    } else {
      ctx.reply('Usage: /lang hi | /lang en | /lang mr');
    }
  });

  // Catch-all text handler
  b.on('text', async (ctx) => {
    const text     = ctx.message.text;
    const lang     = detectLanguage(text);
    const telegramId = ctx.from?.id;

    const thinking = { hi: '⏳ खोज रहा हूं...', mr: '⏳ शोधत आहे...', en: '⏳ Searching...' };
    await ctx.reply(thinking[lang] || thinking.en);

    const schemes = await fetchSchemesForUser(telegramId, lang, 5);
    const msg     = formatSchemes(schemes, lang);

    const header = {
      hi: '📋 *प्रासंगिक सरकारी योजनाएं:*',
      mr: '📋 *संबंधित सरकारी योजना:*',
      en: '📋 *Relevant Government Schemes:*',
    };
    ctx.reply((header[lang] || header.en) + '\n\n' + msg, { parse_mode: 'Markdown' });
  });
}

// ─── Webhook endpoint ────────────────────────────────────────────────────────
router.post('/webhook', (req, res) => {
  const b = getBot();
  if (!b) {
    console.warn('[Telegram] Bot not configured — TELEGRAM_BOT_TOKEN missing');
    return res.sendStatus(200); // Acknowledge silently
  }
  b.handleUpdate(req.body, res);
});

// ─── Helper: register webhook with Telegram ──────────────────────────────────
async function setWebhook(webhookUrl) {
  const b = getBot();
  if (!b) throw new Error('TELEGRAM_BOT_TOKEN not set');
  await b.telegram.setWebhook(webhookUrl);
  console.log('[Telegram] Webhook set to:', webhookUrl);
}

module.exports = router;
module.exports.setWebhook = setWebhook;
