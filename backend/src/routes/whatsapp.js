/**
 * ArthSathi — WhatsApp Bot Route (Twilio)
 *
 * POST /api/whatsapp/webhook  — receives inbound WhatsApp messages from Twilio
 *
 * Env vars required (already in .env.example):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER  (or WHATSAPP_NUMBER for the sandbox)
 */

const express = require('express');
const twilio  = require('twilio');
const { query } = require('../db');
const router  = express.Router();

// ─── Language detection (same heuristic as Telegram) ─────────────────────────
function detectLanguage(text) {
  if (!text) return 'en';
  const devanagari = /[\u0900-\u097F]/;
  if (devanagari.test(text)) {
    const marathiWords = /आहे|आहेत|मला|तुम्ही|नाही|कृपया|विचारा|सांगा/;
    return marathiWords.test(text) ? 'mr' : 'hi';
  }
  return 'en';
}

// ─── Fetch top schemes from DB ────────────────────────────────────────────────
async function fetchTopSchemes(limit = 3) {
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
    console.error('[WhatsApp] DB error fetching schemes:', err.message);
    return [];
  }
}

// ─── Format schemes as plain text (WhatsApp has no Markdown) ─────────────────
function formatSchemes(schemes, lang) {
  if (!schemes || schemes.length === 0) {
    const noData = { hi: 'कोई योजना नहीं मिली।', mr: 'कोणतीही योजना सापडली नाही.', en: 'No schemes found.' };
    return noData[lang] || noData.en;
  }
  return schemes
    .map((s, i) => {
      const name = (s.name && (s.name[lang] || s.name.en || s.name.hi)) || s.name || 'Scheme';
      const desc = (s.description && (s.description[lang] || s.description.en || s.description.hi)) || '';
      const benefit = s.benefit_amount_max ? ` (Max: Rs.${s.benefit_amount_max})` : '';
      const url = s.application_url ? `\nApply: ${s.application_url}` : '';
      return `${i + 1}. ${name}${benefit}\n${desc.slice(0, 100)}...${url}`;
    })
    .join('\n\n');
}

// ─── Build TwiML response ─────────────────────────────────────────────────────
function twimlReply(message) {
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();
  twiml.message(message);
  return twiml.toString();
}

// ─── Webhook handler ──────────────────────────────────────────────────────────
router.post('/webhook', async (req, res) => {
  try {
    const incomingMsg = (req.body.Body || '').trim();
    const from = req.body.From || '';

    if (!incomingMsg) {
      return res.type('text/xml').send(twimlReply('Hello! I am ArthSathi. Send your question about government schemes or insurance.'));
    }

    const lang = detectLanguage(incomingMsg);
    const lower = incomingMsg.toLowerCase();

    // Greeting
    if (lower === 'hi' || lower === 'hello' || lower === 'नमस्ते' || lower === 'नमस्कार') {
      const greet = {
        hi: '🙏 नमस्ते! मैं आर्थसाथी हूं। सरकारी योजना या बीमा के बारे में पूछें।',
        mr: '🙏 नमस्कार! मी आर्थसाथी आहे. सरकारी योजना किंवा विम्याबद्दल विचारा.',
        en: '🙏 Hello! I am ArthSathi. Ask me about government schemes or insurance.',
      };
      return res.type('text/xml').send(twimlReply(greet[lang] || greet.en));
    }

    // Fetch relevant schemes
    const schemes = await fetchTopSchemes(3);
    const formatted = formatSchemes(schemes, lang);

    const header = {
      hi: 'सरकारी योजनाएं:\n\n',
      mr: 'सरकारी योजना:\n\n',
      en: 'Government Schemes:\n\n',
    };

    const reply = (header[lang] || header.en) + formatted;
    return res.type('text/xml').send(twimlReply(reply));

  } catch (err) {
    console.error('[WhatsApp] Webhook error:', err);
    res.type('text/xml').send(twimlReply('Sorry, something went wrong. Please try again.'));
  }
});

module.exports = router;
