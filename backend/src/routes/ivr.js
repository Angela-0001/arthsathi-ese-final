/**
 * ArthSathi — IVR Routes for Exotel
 *
 * Exotel uses GET requests with query params and JSON responses.
 * Call flow is built in Exotel App Bazaar using Passthru + Gather applets.
 *
 * CALL FLOW:
 * 1. Caller dials ExoPhone (02241490536)
 * 2. Exotel App flow calls GET /api/ivr/voice  → language selection
 * 3. Gather applet collects digit (1/2/3)
 * 4. Passthru calls GET /api/ivr/language?digits=1&CallFrom=...
 * 5. Gather collects age, gender, caste, occupation, income
 * 6. GET /api/ivr/recommend → reads schemes aloud
 *
 * SETUP IN EXOTEL:
 * - Create a flow with these applets in sequence:
 *   Gather (URL: /api/ivr/voice) →
 *   Passthru (URL: /api/ivr/language) →
 *   Gather (URL: /api/ivr/collect?step=age) →
 *   ... etc
 *
 * BASE_URL must be set in .env to your ngrok/public URL
 */

'use strict';

const express = require('express');
const https   = require('https');
const { query } = require('../db');
const router  = express.Router();

const BASE_URL = () => process.env.BASE_URL || `https://casing-stopwatch-slate.ngrok-free.dev`;

// ---------------------------------------------------------------------------
// Helper: JSON response for Exotel Gather applet
// ---------------------------------------------------------------------------
function gatherResponse(res, text, nextUrl, maxDigits = 1, timeout = 10) {
  res.json({
    gather_prompt:    { text },
    max_input_digits: maxDigits,
    finish_on_key:    '#',
    input_timeout:    timeout,
    repeat_menu:      2,
    repeat_gather_prompt: { text },
  });
}

// Helper: Passthru response (just play text, no input)
function sayResponse(res, text) {
  res.json({ say: { text } });
}

// ---------------------------------------------------------------------------
// Language helpers
// ---------------------------------------------------------------------------
function langVoice(lang) {
  // Exotel TTS language codes
  const map = { hi: 'hi-IN', mr: 'hi-IN', en: 'en-IN' };
  return map[lang] || 'hi-IN';
}

const GREETINGS = {
  hi: 'Namaste! ArthSathi mein aapka swagat hai. Yeh ek muft sewa hai jo aapko sarkari yojanaon ki jankari deti hai.',
  mr: 'Namaskar! ArthSathi madhe swagat aahe. Hi muft seva aahe.',
  en: 'Welcome to ArthSathi, your free government scheme guide.',
};

// ---------------------------------------------------------------------------
// STEP 1: Incoming call → Language selection
// GET /api/ivr/voice
// ---------------------------------------------------------------------------
router.get('/voice', (req, res) => {
  gatherResponse(
    res,
    'Welcome to ArthSathi. Namaste. Apni bhasha chunen. ' +
    'Hindi ke liye 1 dabain. ' +
    'Marathi ke liye 2 dabain. ' +
    'English ke liye 3 dabain.',
    `${BASE_URL()}/api/ivr/language`,
    1, 10
  );
});

// ---------------------------------------------------------------------------
// STEP 2: Language selected → Ask age
// GET /api/ivr/language?digits=1&CallFrom=...
// ---------------------------------------------------------------------------
router.get('/language', (req, res) => {
  const digit  = (req.query.digits || '').replace(/"/g, '').trim();
  const lang   = digit === '2' ? 'mr' : digit === '3' ? 'en' : 'hi';
  const caller = req.query.CallFrom || req.query.From || 'unknown';

  const ageQ = {
    hi: `${GREETINGS.hi} Ab aapki umar batayein. Kripaya do ank mein dabain. Jaise 35 ke liye 3 aur 5 dabain.`,
    mr: `${GREETINGS.mr} Aata tumchi vay sanga. Do ankde daba.`,
    en: `${GREETINGS.en} Please enter your age in two digits. For example press 3 5 for age 35.`,
  };

  gatherResponse(
    res,
    ageQ[lang] || ageQ.hi,
    `${BASE_URL()}/api/ivr/collect?step=gender&lang=${lang}&caller=${encodeURIComponent(caller)}`,
    2, 12
  );
});

// ---------------------------------------------------------------------------
// STEP 3-7: Sequential data collection via single /collect endpoint
// GET /api/ivr/collect?step=gender&lang=hi&caller=...&age=25&...
// ---------------------------------------------------------------------------
router.get('/collect', async (req, res) => {
  const { step, lang = 'hi', caller = 'unknown' } = req.query;
  const rawDigits = (req.query.digits || '').replace(/"/g, '').trim();

  // Build accumulated params from query string
  const params = { ...req.query };
  delete params.step;
  delete params.digits;

  switch (step) {

    case 'gender': {
      // digits = age
      params.age = rawDigits || '25';
      const gQ = {
        hi: 'Aapka ling kya hai? 1 dabain purush ke liye. 2 dabain mahila ke liye. 3 dabain anya ke liye.',
        mr: 'Tumcha ling? 1 purush. 2 mahila. 3 itar.',
        en: 'What is your gender? Press 1 male. Press 2 female. Press 3 other.',
      };
      const next = `${BASE_URL()}/api/ivr/collect?step=caste&` + new URLSearchParams(params).toString();
      return gatherResponse(res, gQ[lang] || gQ.hi, next, 1, 10);
    }

    case 'caste': {
      params.gender = rawDigits === '1' ? 'male' : rawDigits === '2' ? 'female' : 'other';
      const cQ = {
        hi: 'Aapki jaati shreni? 1 samanya. 2 OBC. 3 SC. 4 ST. 5 anya.',
        mr: 'Tumchi jaat? 1 samanya. 2 OBC. 3 SC. 4 ST. 5 itar.',
        en: 'Caste category? 1 general. 2 OBC. 3 SC. 4 ST. 5 other.',
      };
      const next = `${BASE_URL()}/api/ivr/collect?step=occupation&` + new URLSearchParams(params).toString();
      return gatherResponse(res, cQ[lang] || cQ.hi, next, 1, 10);
    }

    case 'occupation': {
      const casteMap = { '1': 'general', '2': 'obc', '3': 'sc', '4': 'st', '5': 'other' };
      params.caste = casteMap[rawDigits] || 'general';
      const oQ = {
        hi: 'Aap kya kaam karte hain? 1 kisan. 2 khet mazdoor. 3 dihadi mazdoor. 4 swa-rozgar. 5 nirman. 6 anya.',
        mr: 'Tumhi kay kam karta? 1 shetkari. 2 shet mazoor. 3 rozandari. 4 swa-rozgar. 5 bandhkam. 6 itar.',
        en: 'Occupation? 1 farmer. 2 farm labour. 3 daily wage. 4 self employed. 5 construction. 6 other.',
      };
      const next = `${BASE_URL()}/api/ivr/collect?step=income&` + new URLSearchParams(params).toString();
      return gatherResponse(res, oQ[lang] || oQ.hi, next, 1, 10);
    }

    case 'income': {
      const occMap = { '1': 'farmer', '2': 'farm_laborer', '3': 'daily_wage_worker', '4': 'self_employed', '5': 'construction_worker', '6': 'other' };
      params.occupation = occMap[rawDigits] || 'other';
      const iQ = {
        hi: 'Aap har mahine kitna kamate hain? Sirf ank dabain. Jaise 5000 ke liye 5-0-0-0.',
        mr: 'Mahinya la kiti kamata? Sirf ank daba.',
        en: 'Monthly income in rupees? Enter digits. Example 5000.',
      };
      const next = `${BASE_URL()}/api/ivr/recommend?` + new URLSearchParams(params).toString();
      return gatherResponse(res, iQ[lang] || iQ.hi, next, 5, 15);
    }

    default:
      return res.json({ say: { text: 'Invalid step. Please call again.' } });
  }
});

// ---------------------------------------------------------------------------
// FINAL STEP: Generate and read recommendations
// GET /api/ivr/recommend?age=25&gender=male&caste=sc&occupation=farmer&income=5000&lang=hi&caller=...
// ---------------------------------------------------------------------------
router.get('/recommend', async (req, res) => {
  const { lang = 'hi', caller = 'unknown' } = req.query;
  const rawDigits = (req.query.digits || '').replace(/"/g, '').trim();

  const age        = parseInt(req.query.age, 10)    || 25;
  const gender     = req.query.gender               || 'other';
  const caste      = req.query.caste                || 'general';
  const occupation = req.query.occupation           || 'other';
  const income     = parseInt(rawDigits, 10)        || parseInt(req.query.income, 10) || 0;

  try {
    // Save caller to DB
    let userId = null;
    try {
      const phone = caller !== 'unknown' ? caller.replace(/\D/g, '').slice(-10) : null;
      if (phone) {
        const existing = await query('SELECT id FROM users WHERE phone = $1', [phone]);
        if (existing.rows.length > 0) {
          userId = existing.rows[0].id;
          await query(
            `UPDATE users SET age=$1, gender=$2, caste_category=$3, occupation=$4, monthly_income=$5, preferred_language=$6 WHERE id=$7`,
            [age, gender, caste, occupation, income, lang, userId]
          );
        } else {
          const r = await query(
            `INSERT INTO users (phone, age, gender, caste_category, occupation, monthly_income, preferred_language, is_disabled, bpl_card)
             VALUES ($1,$2,$3,$4,$5,$6,$7,false,false) RETURNING id`,
            [phone, age, gender, caste, occupation, income, lang]
          );
          userId = r.rows[0].id;
        }
      }
    } catch (dbErr) {
      console.warn('[IVR] DB error (non-fatal):', dbErr.message);
    }

    // Get schemes from DB filtered by profile
    const schemeResult = await query(
      `SELECT name, benefit_value, application_url
       FROM schemes
       WHERE is_active = TRUE
         AND (min_age IS NULL OR min_age <= $1)
         AND (max_age IS NULL OR max_age >= $1)
         AND (max_income IS NULL OR max_income >= $2)
       ORDER BY engagement_weight DESC NULLS LAST
       LIMIT 3`,
      [age, income]
    );

    const insResult = await query(
      `SELECT name, annual_premium, coverage_amount
       FROM insurance_policies
       WHERE is_active = TRUE
         AND (min_age IS NULL OR min_age <= $1)
         AND (max_age IS NULL OR max_age >= $1)
       ORDER BY annual_premium ASC NULLS FIRST
       LIMIT 2`,
      [age]
    );

    const schemes   = schemeResult.rows;
    const insurance = insResult.rows;

    // Build response text
    const intro = {
      hi: 'Aapke liye yeh sarkari yojanaen available hain. ',
      mr: 'Tumchyasathi ya sarkari yojana available aaheth. ',
      en: 'Based on your profile, here are your eligible schemes. ',
    };

    let text = intro[lang] || intro.hi;

    if (schemes.length > 0) {
      const header = { hi: 'Sarkari Yojanaen. ', mr: 'Sarkari Yojana. ', en: 'Government Schemes. ' };
      text += header[lang] || header.hi;
      schemes.forEach((s, i) => {
        const name = typeof s.name === 'object' ? (s.name.hi || s.name.en || 'Yojana') : (s.name || 'Yojana');
        const benefit = s.benefit_value ? `. Labh: ${s.benefit_value} rupaye.` : '.';
        text += `${i + 1}. ${name}${benefit} `;
      });
    }

    if (insurance.length > 0) {
      const header = { hi: 'Beema Yojanaen. ', mr: 'Vima Yojana. ', en: 'Insurance Plans. ' };
      text += header[lang] || header.hi;
      insurance.forEach((p, i) => {
        const name    = typeof p.name === 'object' ? (p.name.hi || p.name.en || 'Beema') : (p.name || 'Beema');
        const premium = p.annual_premium === 0 ? 'muft' : `${p.annual_premium} rupaye saalik`;
        const cover   = p.coverage_amount ? `. Cover: ${(p.coverage_amount / 100000).toFixed(1)} lakh rupaye` : '';
        text += `${i + 1}. ${name}. ${premium}${cover}. `;
      });
    }

    const closing = {
      hi: 'Adhik jankari ke liye arthsathi dot in par jayen. Dhanyawad. Jai Hind.',
      mr: 'Adhik mahitisathi arthsathi dot in la bhet dya. Dhanyawad.',
      en: 'For more information visit arthsathi dot in. Thank you.',
    };
    text += closing[lang] || closing.hi;

    res.json({ say: { text, language: langVoice(lang) } });

  } catch (err) {
    console.error('[IVR] Recommend error:', err.message);
    res.json({
      say: {
        text: 'Aapki jankari ke liye dhanyawad. Sarkari yojanaon ki jankari ke liye arthsathi dot in par jayen. PM KISAN, Ayushman Bharat, PMJJBY jaise yojanaon ka laabh uthayein. Dhanyawad.',
        language: 'hi-IN',
      },
    });
  }
});

// ---------------------------------------------------------------------------
// Outbound call initiator (Exotel)
// POST /api/ivr/call  { to: "+918424960449", lang: "hi" }
// ---------------------------------------------------------------------------
router.post('/call', async (req, res) => {
  const { to, lang = 'hi' } = req.body;

  const sid      = process.env.EXOTEL_SID;
  const apiKey   = process.env.EXOTEL_API_KEY;
  const apiToken = process.env.EXOTEL_API_TOKEN;
  const from     = process.env.EXOTEL_PHONE || '02241490536';
  const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
  const base     = process.env.BASE_URL || `https://casing-stopwatch-slate.ngrok-free.dev`;

  if (!sid || !apiKey || !apiToken) {
    return res.status(503).json({ success: false, error: 'Exotel credentials not configured in .env' });
  }
  if (!to) {
    return res.status(400).json({ success: false, error: 'to (phone number) is required' });
  }

  const params = new URLSearchParams({
    From:      from,
    To:        to,
    CallerId:  from,
    Url:       `${base}/api/ivr/voice`,
    Method:    'GET',
    StatusCallback: `${base}/api/ivr/status`,
    CustomField: lang,
  });

  const options = {
    hostname: `${subdomain}`,
    path:     `/v1/Accounts/${sid}/Calls/connect.json`,
    method:   'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${apiKey}:${apiToken}`).toString('base64'),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (apiRes.statusCode === 200 || apiRes.statusCode === 201) {
          res.json({ success: true, call_sid: parsed.Call?.Sid, status: parsed.Call?.Status, message: `Calling ${to}...` });
        } else {
          res.status(400).json({ success: false, error: parsed.RestException?.Message || data });
        }
      } catch {
        res.status(500).json({ success: false, error: data });
      }
    });
  });

  apiReq.on('error', e => res.status(500).json({ success: false, error: e.message }));
  apiReq.write(params.toString());
  apiReq.end();
});

// Status callback
router.post('/status', (req, res) => {
  console.log('[IVR] Call status:', req.body);
  res.sendStatus(200);
});

// Test endpoint
router.get('/test', async (req, res) => {
  try {
    const schemes = await query('SELECT name FROM schemes WHERE is_active=TRUE LIMIT 3');
    res.json({
      success: true,
      message: 'IVR ready. Set Exotel flow to call GET /api/ivr/voice',
      exophone: process.env.EXOTEL_PHONE,
      base_url: BASE_URL(),
      sample_schemes: schemes.rows.map(s => typeof s.name === 'object' ? s.name.en : s.name),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
