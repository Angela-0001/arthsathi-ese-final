/**
 * ArthSathi — IVR (Interactive Voice Response) Routes
 *
 * Handles Twilio webhook calls so users without smartphones can access
 * ArthSathi via a regular phone call. The complete call flow mirrors the
 * web onboarding experience:
 *
 *   CALL FLOW
 *   ─────────
 *   1. Caller dials ArthSathi number
 *   2. Greeted in Hindi (default), offered language selection via keypad
 *   3. Guided through core onboarding questions via voice + DTMF
 *      (age, gender, caste, occupation, income, bank account, financial goal)
 *   4. Answers fed into the recommendation engine
 *   5. Top 2 scheme + top 2 insurance recommendations read aloud
 *   6. Call data stored in the same users/financial_profiles tables as web
 *
 *   MANUAL STEP REQUIRED BEFORE GOING LIVE
 *   ────────────────────────────────────────
 *   Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env
 *   and point the Twilio webhook to: POST https://<server>/api/ivr/voice
 *   (See README.md — IVR section for full instructions)
 *
 * IMPLEMENTATION NOTE
 * ───────────────────
 * All state is passed as URL parameters through Twilio's <Redirect> so the
 * server remains fully stateless between webhook calls. This means no session
 * store is needed and any server restart is safe.
 *
 * TwiML voice is used for all prompts. When Piper/pyttsx3 TTS produces audio,
 * we can serve it as <Play>, but we use <Say> as the always-available fallback.
 */

const express = require('express');
const twilio  = require('twilio');
const { query }               = require('../db');
const { getRecommendations, isEngineHealthy } = require('../services/engineService');

const router = express.Router();

// ---------------------------------------------------------------------------
// Twilio middleware — validate webhook signatures in production
// ---------------------------------------------------------------------------
function twilioValidator(req, res, next) {
  // In development, skip signature validation
  if (process.env.NODE_ENV !== 'production') return next();

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return next();

  const valid = twilio.validateExpressRequest(req, authToken);
  if (!valid) {
    return res.status(403).send('Forbidden - Invalid Twilio signature');
  }
  next();
}

router.use(twilioValidator);

// ---------------------------------------------------------------------------
// Helper: Build a TwiML response
// ---------------------------------------------------------------------------
function twiml(res, builderFn) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const resp = new VoiceResponse();
  builderFn(resp);
  res.type('text/xml');
  res.send(resp.toString());
}

// Language prompts — one per supported language
const LANG_GREETINGS = {
  hi: 'Namaste! ArthSathi mein aapka swagat hai. Yeh ek muft sewa hai jo aapko sarkari yojanaon aur beema ke baare mein jankari deti hai.',
  mr: 'Namaskar! ArthSathi madhe aapale swagat ahe. Hi ek muft seva aahe.',
  ta: 'Vanakkam! ArthSathi-il ungalukkku varaverpu. Idhu oru illavasa sevai.',
  te: 'Namaskaram! ArthSathi lo mee swagatam. Ee oka viramaina seva.',
  bn: 'Namaskar! ArthSathi-te apnar swagat. Ei ekti binamulye seva.',
  en: 'Welcome to ArthSathi, your free government scheme and insurance guide.',
};

const LANG_NAMES = { hi: 'Hindi', mr: 'Marathi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali', en: 'English' };

// DTMF → language mapping
const KEY_TO_LANG = { '1': 'hi', '2': 'mr', '3': 'ta', '4': 'te', '5': 'bn', '6': 'en' };

// Base URL for IVR redirects
const BASE_URL = () => process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

// ---------------------------------------------------------------------------
// STEP 1: Incoming call → Language selection
// POST /api/ivr/voice
// ---------------------------------------------------------------------------
router.post('/voice', (req, res) => {
  twiml(res, (resp) => {
    const gather = resp.gather({
      numDigits:   '1',
      action:      `${BASE_URL()}/api/ivr/language`,
      method:      'POST',
      timeout:     '10',
      finishOnKey: '',
    });

    gather.say({
      language: 'hi-IN',
      voice:    'Polly.Aditi',
    }, [
      'Welcome to ArthSathi. Apni bhasha chunen.',
      'Ek dabain Hindi ke liye.',
      'Do dabain Marathi ke liye.',
      'Teen dabain Tamil ke liye.',
      'Char dabain Telugu ke liye.',
      'Paanch dabain Bengali ke liye.',
      'Chhe dabain English ke liye.',
    ].join(' '));

    // If no input, repeat
    resp.redirect(`${BASE_URL()}/api/ivr/voice`);
  });
});

// ---------------------------------------------------------------------------
// STEP 2: Language selected → Start onboarding
// POST /api/ivr/language
// ---------------------------------------------------------------------------
router.post('/language', (req, res) => {
  const digit = req.body.Digits || '1';
  const lang  = KEY_TO_LANG[digit] || 'hi';
  const caller = req.body.From || 'unknown';

  twiml(res, (resp) => {
    resp.say({ language: langVoice(lang) }, LANG_GREETINGS[lang]);

    // Ask for age
    const gather = resp.gather({
      numDigits: '2',
      action:    `${BASE_URL()}/api/ivr/age?lang=${lang}&caller=${encodeURIComponent(caller)}`,
      method:    'POST',
      timeout:   '10',
    });
    gather.say({ language: langVoice(lang) }, ageQuestion(lang));

    resp.redirect(`${BASE_URL()}/api/ivr/language`);
  });
});

// ---------------------------------------------------------------------------
// STEP 3: Age
// ---------------------------------------------------------------------------
router.post('/age', (req, res) => {
  const { lang = 'hi', caller = 'unknown' } = req.query;
  const age = parseInt(req.body.Digits, 10) || 0;

  twiml(res, (resp) => {
    const gather = resp.gather({
      numDigits: '1',
      action:    `${BASE_URL()}/api/ivr/gender?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}`,
      method:    'POST',
      timeout:   '10',
    });
    gather.say({ language: langVoice(lang) }, genderQuestion(lang));
    resp.redirect(`${BASE_URL()}/api/ivr/age?lang=${lang}&caller=${encodeURIComponent(caller)}`);
  });
});

// ---------------------------------------------------------------------------
// STEP 4: Gender
// ---------------------------------------------------------------------------
router.post('/gender', (req, res) => {
  const { lang, caller, age } = req.query;
  const genders = { '1': 'male', '2': 'female', '3': 'other' };
  const gender  = genders[req.body.Digits] || 'other';

  twiml(res, (resp) => {
    const gather = resp.gather({
      numDigits: '1',
      action:    `${BASE_URL()}/api/ivr/caste?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}`,
      method:    'POST',
      timeout:   '10',
    });
    gather.say({ language: langVoice(lang) }, casteQuestion(lang));
    resp.redirect(`${BASE_URL()}/api/ivr/gender?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}`);
  });
});

// ---------------------------------------------------------------------------
// STEP 5: Caste
// ---------------------------------------------------------------------------
router.post('/caste', (req, res) => {
  const { lang, caller, age, gender } = req.query;
  const castes = { '1': 'general', '2': 'obc', '3': 'sc', '4': 'st', '5': 'other' };
  const caste  = castes[req.body.Digits] || 'other';

  twiml(res, (resp) => {
    const gather = resp.gather({
      numDigits: '1',
      action:    `${BASE_URL()}/api/ivr/occupation?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}&caste=${caste}`,
      method:    'POST',
      timeout:   '10',
    });
    gather.say({ language: langVoice(lang) }, occupationQuestion(lang));
    resp.redirect(`${BASE_URL()}/api/ivr/caste?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}`);
  });
});

// ---------------------------------------------------------------------------
// STEP 6: Occupation
// ---------------------------------------------------------------------------
router.post('/occupation', (req, res) => {
  const { lang, caller, age, gender, caste } = req.query;
  const occs = {
    '1': 'farmer',   '2': 'farm_laborer', '3': 'daily_wage',
    '4': 'self_employed', '5': 'construction_worker', '6': 'other',
  };
  const occupation = occs[req.body.Digits] || 'other';

  twiml(res, (resp) => {
    const gather = resp.gather({
      numDigits: '4',
      action:    `${BASE_URL()}/api/ivr/income?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}&caste=${caste}&occ=${occupation}`,
      method:    'POST',
      timeout:   '15',
    });
    gather.say({ language: langVoice(lang) }, incomeQuestion(lang));
    resp.redirect(`${BASE_URL()}/api/ivr/occupation?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}&caste=${caste}`);
  });
});

// ---------------------------------------------------------------------------
// STEP 7: Monthly income → Ask bank account
// ---------------------------------------------------------------------------
router.post('/income', (req, res) => {
  const { lang, caller, age, gender, caste, occ } = req.query;
  const income = parseInt(req.body.Digits, 10) || 0;

  twiml(res, (resp) => {
    const gather = resp.gather({
      numDigits: '1',
      action:    `${BASE_URL()}/api/ivr/bank?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}&caste=${caste}&occ=${occ}&income=${income}`,
      method:    'POST',
      timeout:   '10',
    });
    gather.say({ language: langVoice(lang) }, bankQuestion(lang));
    resp.redirect(`${BASE_URL()}/api/ivr/income?lang=${lang}&caller=${encodeURIComponent(caller)}&age=${age}&gender=${gender}&caste=${caste}&occ=${occ}`);
  });
});

// ---------------------------------------------------------------------------
// STEP 8: Bank account → Generate recommendations
// ---------------------------------------------------------------------------
router.post('/bank', async (req, res) => {
  const { lang, caller, age, gender, caste, occ, income } = req.query;
  const hasBank = req.body.Digits === '1';

  try {
    // Build profile object
    const monthlyIncome = parseInt(income, 10) || 0;
    const annualIncome  = monthlyIncome * 12;

    const profile = {
      age:              parseInt(age, 10) || 25,
      gender:           gender || 'other',
      caste_category:   caste  || 'general',
      occupation:       occ    || 'other',
      annual_income:    annualIncome,
      monthly_income:   monthlyIncome,
      has_bank_account: hasBank,
      has_jan_dhan_account: hasBank,
      state:            null,
      financial_goal:   null,
      urgency_level:    3,
      goal_amount:      null,
    };

    // Save to database
    const phone = caller !== 'unknown' ? caller : null;
    let userId = null;
    try {
      let userResult;
      if (phone) {
        userResult = await query(
          `INSERT INTO users (phone_number, preferred_language, interaction_mode, created_via)
           VALUES ($1, $2, 'voice', 'ivr')
           ON CONFLICT (phone_number) DO UPDATE SET
             preferred_language = EXCLUDED.preferred_language,
             updated_at = NOW()
           WHERE users.phone_number IS NOT NULL
           RETURNING id`,
          [phone, lang]
        );
      } else {
        userResult = await query(
          `INSERT INTO users (phone_number, preferred_language, interaction_mode, created_via)
           VALUES (NULL, $1, 'voice', 'ivr') RETURNING id`,
          [lang]
        );
      }
      userId = userResult.rows[0].id;

      await query(
        `INSERT INTO financial_profiles (
           user_id, age, gender, caste_category, occupation,
           monthly_income, annual_income, has_bank_account, has_jan_dhan_account, completed_at
         ) VALUES ($1,$2,$3::gender_t,$4::caste_t,$5::occupation_t,$6,$7,$8,$8,NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           age = EXCLUDED.age,
           monthly_income = EXCLUDED.monthly_income,
           annual_income  = EXCLUDED.annual_income,
           updated_at     = NOW()`,
        [userId, profile.age, profile.gender, profile.caste_category,
         profile.occupation, monthlyIncome, annualIncome, hasBank, hasBank]
      );
    } catch (dbErr) {
      console.error('[IVR] DB save error:', dbErr.message);
    }

    // Get recommendations via the Python engine
    let schemes = [], insurance = [];
    try {
      const { getRecommendations } = require('../services/engineService');
      const result = await getRecommendations(userId || 'anonymous', { limit: 5, itemType: 'both' });
      schemes   = result.schemes   || [];
      insurance = result.insurance || [];
    } catch (engErr) {
      console.error('[IVR] Engine error:', engErr.message);
      // Fall back to simple DB query for top schemes
      const fallback = await query('SELECT name FROM schemes WHERE is_active = TRUE LIMIT 3');
      schemes = fallback.rows;
    }

    // Build TwiML with results
    twiml(res, (resp) => {
      const v = langVoice(lang);

      resp.say({ language: v }, resultsIntro(lang));

      // Read top 2 schemes
      const topSchemes = schemes.slice(0, 2);
      if (topSchemes.length > 0) {
        resp.say({ language: v }, schemesHeader(lang));
        topSchemes.forEach((s, i) => {
          const benefit = s.benefit_amount ? `, benefit: ${s.benefit_amount} rupees per year` : '';
          resp.say({ language: v }, `${i + 1}. ${s.name_en}${benefit}.`);
          if (s.benefit_description) {
            resp.say({ language: v }, s.benefit_description.slice(0, 200));
          }
        });
      } else {
        resp.say({ language: v }, noSchemesMsg(lang));
      }

      // Read top 2 insurance
      const topInsurance = insurance.slice(0, 2);
      if (topInsurance.length > 0) {
        resp.say({ language: v }, insuranceHeader(lang));
        topInsurance.forEach((p, i) => {
          const prem = p.annual_premium === 0 ? 'free' : `${p.annual_premium} rupees per year`;
          resp.say({ language: v }, `${i + 1}. ${p.name_en}. Premium: ${prem}. Coverage: ${(p.coverage_amount || 0) / 100000} lakh rupees.`);
        });
      }

      // Closing
      resp.say({ language: v }, closing(lang));
      resp.hangup();
    });

  } catch (err) {
    console.error('[IVR] Error generating recommendations:', err);
    twiml(res, (resp) => {
      resp.say({ language: langVoice(lang) }, 'Kshama karein, koi samasya aa gayi. Kripaya baad mein call karein. Dhanyawad.');
      resp.hangup();
    });
  }
});

// ---------------------------------------------------------------------------
// Test endpoint — simulate an IVR call without Twilio
// GET /api/ivr/test
// ---------------------------------------------------------------------------
router.get('/test', async (req, res) => {
  try {
    // Create a synthetic test user
    const testProfile = {
      age: 35, gender: 'male', caste_category: 'sc', occupation: 'farmer',
      annual_income: 60000, monthly_income: 5000,
      has_bank_account: true, state: 'Maharashtra', financial_goal: 'farming',
      urgency_level: 3, ration_card_type: 'phh', is_bpl: true,
    };

    // Temporarily insert test user, get recs, delete
    const tmpUser = await query(
      `INSERT INTO users (preferred_language, interaction_mode, created_via)
       VALUES ('hi','voice','ivr') RETURNING id`
    );
    const tmpId = tmpUser.rows[0].id;

    await query(
      `INSERT INTO financial_profiles (user_id,age,gender,caste_category,occupation,
         monthly_income,annual_income,has_bank_account,ration_card_type,financial_goal,urgency_level,completed_at)
       VALUES ($1,$2,$3::gender_t,$4::caste_t,$5::occupation_t,$6,$7,$8,$9::ration_card_t,$10,$11,NOW())`,
      [tmpId,35,'male','sc','farmer',5000,60000,true,'phh','farming',3]
    );

    const result = await getRecommendations(tmpId, { limit: 3, itemType: 'both' });

    // Clean up temp user
    await query('DELETE FROM users WHERE id = $1', [tmpId]);

    res.json({
      success: true,
      test_profile: testProfile,
      top_schemes:   (result.schemes   || []).slice(0,3).map(s => ({ name: (s.name?.en || s.name_en || ''), score: s.score })),
      top_insurance: (result.insurance || []).slice(0,2).map(p => ({ name: (p.name?.en || p.name_en || ''), score: p.score })),
      message: 'IVR flow built. One manual step to go live: create Twilio account + set webhook to /api/ivr/voice. See README.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Twilio voice locale helpers
// ---------------------------------------------------------------------------
function langVoice(lang) {
  const map = { hi: 'hi-IN', mr: 'hi-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', en: 'en-IN' };
  return map[lang] || 'hi-IN';
}

// ---------------------------------------------------------------------------
// Script strings per language
// ---------------------------------------------------------------------------
function ageQuestion(lang) {
  const q = {
    hi: 'Aapki umar kitni hai? Kripaya do ank mein dabain. Jaise 35 ke liye 3 aur 5 dabain.',
    mr: 'Tumchi vay kiti ahe? Kripaya do ankde daba.',
    ta: 'Ungal vayadu enna? Irandu elakkam anukku anukku anukku anukku. Thayal seyyavum.',
    te: 'Meeru vayassu enkuvo? Rendu digits press cheyyandi.',
    bn: 'Apnar boyos koto? Duti digit press korun.',
    en: 'How old are you? Please press two digits. For example, press 3 5 for age 35.',
  };
  return q[lang] || q.hi;
}

function genderQuestion(lang) {
  const q = {
    hi: 'Aapka ling kya hai? 1 dabain purush ke liye. 2 dabain mahila ke liye. 3 dabain any ke liye.',
    mr: 'Tumcha ling kaye? 1 purush. 2 mahila. 3 itar.',
    ta: 'Ungal paalinum enna? 1 - aaN. 2 - pen. 3 - pirar.',
    te: 'Meeru linga vivaram entha? 1 - purushuni. 2 - stree. 3 - ithara.',
    bn: 'Apnar ling ki? 1 - purush. 2 - mohila. 3 - anya.',
    en: 'What is your gender? Press 1 for male. Press 2 for female. Press 3 for other.',
  };
  return q[lang] || q.hi;
}

function casteQuestion(lang) {
  const q = {
    hi: 'Aapki jaati shreni kya hai? 1 dabain samanya ke liye. 2 OBC. 3 SC. 4 ST. 5 anya.',
    mr: 'Tumchi jaat shreni kaye? 1 samanya. 2 OBC. 3 SC. 4 ST. 5 itar.',
    ta: 'Ungal jaati pirivu enna? 1 - samanya. 2 - OBC. 3 - SC. 4 - ST. 5 - ithara.',
    te: 'Meeru kula vargam entha? 1 - samanya. 2 - OBC. 3 - SC. 4 - ST. 5 - ithara.',
    bn: 'Apnar jati barga ki? 1 - samanya. 2 - OBC. 3 - SC. 4 - ST. 5 - anya.',
    en: 'What is your caste category? Press 1 general. 2 OBC. 3 SC. 4 ST. 5 other.',
  };
  return q[lang] || q.hi;
}

function occupationQuestion(lang) {
  const q = {
    hi: 'Aap kya kaam karte hain? 1 kisan. 2 khet mazdoor. 3 dihadi mazdoor. 4 swa-rozgar. 5 nirman mazdoor. 6 anya.',
    mr: 'Tumhi kaye kam karta? 1 shetkari. 2 shet mazoor. 3 rozandari. 4 swa-rozgar. 5 bandhkam. 6 itar.',
    ta: 'Neengal enna thozhil seygirirkal? 1 vivasayi. 2 vivasaya thozhilali. 3 naal kauli. 4 suyathozhil. 5 kattumaram. 6 matravai.',
    en: 'What is your occupation? Press 1 farmer. 2 farm labourer. 3 daily wage. 4 self employed. 5 construction. 6 other.',
  };
  return q[lang] || q.en;
}

function incomeQuestion(lang) {
  const q = {
    hi: 'Aap har mahine kitna kamate hain rupyon mein? Sirf ank dabain. Jaise 5000 ke liye 5-0-0-0 dabain.',
    mr: 'Tumi mahinya la kiti kamata rupayat? Sirf ank daba.',
    ta: 'Neenga maasam eriya soambu etthanai rupee? Thayal seyyavum.',
    en: 'How much do you earn per month in rupees? Press the digits. For example 5000.',
  };
  return q[lang] || q.en;
}

function bankQuestion(lang) {
  const q = {
    hi: 'Kya aapka bank khata hai? 1 dabain haan ke liye. 2 dabain nahin ke liye.',
    mr: 'Tumcha bank khate aahe ka? 1 hoy. 2 nahi.',
    ta: 'Ungalukku vangki kanavai irukkirataa? 1 - aamam. 2 - illai.',
    en: 'Do you have a bank account? Press 1 for yes. Press 2 for no.',
  };
  return q[lang] || q.en;
}

function resultsIntro(lang) {
  const q = {
    hi: 'Aapki jankari ke aadhaar par, yahan kuch sarkari yojanaen aur beema hain jo aapko mil sakti hain.',
    mr: 'Tumchya mahitinusar, tumhala milanare sarkari yojana ani vima yethe aahet.',
    ta: 'Ungal thivaigalin adissiyil, intha arasanga thiitangalum kaapattu thiitangalum ungalukkku kidaikkalaam.',
    en: 'Based on your information, here are the government schemes and insurance plans you may qualify for.',
  };
  return q[lang] || q.en;
}

function schemesHeader(lang) {
  const q = { hi: 'Sarkari Yojanaen:', mr: 'Sarkari Yojana:', ta: 'Arasanga Thiitangal:', en: 'Government Schemes:' };
  return q[lang] || q.en;
}

function insuranceHeader(lang) {
  const q = { hi: 'Beema Yojanaen:', mr: 'Vima Yojana:', ta: 'Kaapattu Thiitangal:', en: 'Insurance Plans:' };
  return q[lang] || q.en;
}

function noSchemesMsg(lang) {
  const q = {
    hi: 'Aapke liye koi yojana nahi mili. Adhik jankari ke liye arthsathi dot in par jayen.',
    en: 'No schemes found for your profile. Please visit arthsathi dot in for more information.',
  };
  return q[lang] || q.en;
}

function closing(lang) {
  const q = {
    hi: 'Adhik jankari ke liye arthsathi dot in par jayen ya dubara call karein. Dhanyawad, jai hind.',
    mr: 'Adhik mahitisathi arthsathi dot in la bhet dya. Dhanyawad.',
    ta: 'Meendum thagavalirukkum arthsathi dot in-ai paarkavum. Nandri.',
    te: 'Meeru thappakunda arthsathi dot in ni choodandi. Dhanyavaadaalu.',
    bn: 'Arthsathi dot in visit korun. Dhonnyobad.',
    en: 'For more information visit arthsathi dot in or call back. Thank you. Jai Hind.',
  };
  return q[lang] || q.en;
}

module.exports = router;
