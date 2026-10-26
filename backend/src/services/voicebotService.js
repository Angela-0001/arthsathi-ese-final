'use strict';

/**
 * ArthSathi — Exotel WebSocket Voicebot (DTMF-based)
 * Full questionnaire matching the web onboarding.
 * Uses Groq for accurate profile-based scheme + insurance recommendations.
 */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
ffmpegInstaller; // ensure loaded
const FFMPEG  = require('@ffmpeg-installer/ffmpeg').path;
const Groq    = require('groq-sdk');

const groq       = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL      = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';

// ── Full DTMF questionnaire ─────────────────────────────────────────────────
const QUESTIONS = [
  {
    key:  'age_group',
    text: 'Pehla sawaal. Aapki umar kitni hai? Ek dabain 18 se 30 saal ke liye. Do dabain 31 se 45 ke liye. Teen dabain 46 se 60 ke liye. Chaar dabain 60 se zyada ke liye.',
    map:  { '1': 25, '2': 38, '3': 53, '4': 65 },
    profileKey: 'age',
  },
  {
    key:  'gender',
    text: 'Doosra sawaal. Aap purush hain ya mahila? Purush ke liye ek dabain. Mahila ke liye do dabain.',
    map:  { '1': 'male', '2': 'female' },
    profileKey: 'gender',
  },
  {
    key:  'caste',
    text: 'Teesra sawaal. Aapki jaati shreni? Samanya ke liye ek. OBC ke liye do. SC ke liye teen. ST ke liye chaar.',
    map:  { '1': 'general', '2': 'obc', '3': 'sc', '4': 'st' },
    profileKey: 'caste_category',
  },
  {
    key:  'occupation',
    text: 'Chautha sawaal. Aap kya kaam karte hain? Kisan ke liye ek. Khet mazdoor ke liye do. Dihadi mazdoor ke liye teen. Swa-rozgar ya vyapar ke liye chaar. Nirman mazdoor ke liye paanch. Chhatra ya berozgaar ke liye chhah.',
    map:  { '1': 'farmer', '2': 'farm_laborer', '3': 'daily_wage_worker', '4': 'self_employed', '5': 'construction_worker', '6': 'other' },
    profileKey: 'occupation',
  },
  {
    key:  'income',
    text: 'Paanchwa sawaal. Aap har mahine kitna kamate hain? Paanch hazaar se kam ke liye ek. Paanch se das hazaar ke liye do. Das se bees hazaar ke liye teen. Bees hazaar se zyada ke liye chaar.',
    map:  { '1': 3000, '2': 7500, '3': 15000, '4': 25000 },
    profileKey: 'monthly_income',
  },
  {
    key:  'ration_card',
    text: 'Chhatwa sawaal. Aapke paas ration card hai? AAY ya antyodaya card ke liye ek. PHH ya priority card ke liye do. Koi card nahi ke liye teen.',
    map:  { '1': 'aay', '2': 'phh', '3': 'none' },
    profileKey: 'ration_card_type',
  },
  {
    key:  'bank_account',
    text: 'Saatwa sawaal. Kya aapka bank khata hai? Haan ke liye ek. Nahin ke liye do.',
    map:  { '1': true, '2': false },
    profileKey: 'has_bank_account',
  },
  {
    key:  'disability',
    text: 'Aathwa sawaal. Kya aapko koi divyangta hai? Haan ke liye ek. Nahin ke liye do.',
    map:  { '1': true, '2': false },
    profileKey: 'has_disability',
  },
  {
    key:  'widow',
    text: 'Kya aap vidhwa hain? Haan ke liye ek. Nahin ke liye do.',
    show: (p) => p.gender === 'female',
    map:  { '1': true, '2': false },
    profileKey: 'is_widow',
  },
  {
    key:  'girl_child',
    text: 'Kya aapke ghar mein beti hai? Haan ke liye ek. Nahin ke liye do.',
    show: (p) => p.gender === 'female',
    map:  { '1': true, '2': false },
    profileKey: 'has_girl_child',
  },
  {
    key:  'student',
    text: 'Kya aap ya aapke ghar mein koi chhatra hai? Haan ke liye ek. Nahin ke liye do.',
    show: (p) => (p.age || 99) <= 30,
    map:  { '1': true, '2': false },
    profileKey: 'is_student',
  },
  {
    key:  'financial_goal',
    text: 'Aakhri sawaal. Aapka mukhya lakshya kya hai? Khet ya mazdoori ke liye ek. Makaan ke liye do. Sehat ke liye teen. Padhai ke liye chaar. Beema ke liye paanch. Bachat ke liye chhah.',
    map:  { '1': 'farming', '2': 'housing', '3': 'health', '4': 'education', '5': 'insurance', '6': 'savings' },
    profileKey: 'financial_goal',
  },
];

// ── Generate TTS MP3 ────────────────────────────────────────────────────────
function generateTTS(text) {
  return new Promise((resolve, reject) => {
    const tmpMp3 = path.join(os.tmpdir(), `tts_${Date.now()}.mp3`);
    const script = `from gtts import gTTS\ntts = gTTS(text=${JSON.stringify(text)}, lang='hi', slow=False)\ntts.save(${JSON.stringify(tmpMp3)})\nprint("OK")`;
    const tmpPy  = path.join(os.tmpdir(), `tts_${Date.now()}.py`);
    fs.writeFileSync(tmpPy, script);
    const proc = spawn(PYTHON_BIN, [tmpPy]);
    let err = '';
    proc.stderr.on('data', c => err += c);
    proc.on('close', code => {
      fs.unlink(tmpPy, () => {});
      if (code === 0 && fs.existsSync(tmpMp3)) resolve(tmpMp3);
      else reject(new Error(`TTS: ${err.slice(0, 150)}`));
    });
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); reject(new Error('TTS timeout')); }, 30000);
  });
}

// ── Convert MP3 → PCM16 8kHz ────────────────────────────────────────────────
function convertToPCM16(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace('.mp3', '.raw');
    const proc = spawn(FFMPEG, ['-y', '-i', inputPath, '-ar', '8000', '-ac', '1', '-f', 's16le', outputPath]);
    let err = '';
    proc.stderr.on('data', c => err += c.toString());
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`ffmpeg: ${err.slice(-150)}`));
    });
    proc.on('error', e => reject(new Error(`ffmpeg spawn: ${e.message}`)));
    setTimeout(() => { proc.kill(); reject(new Error('ffmpeg timeout')); }, 30000);
  });
}

// ── Send TTS audio over WebSocket ───────────────────────────────────────────
async function sendAudio(ws, text, streamSid, seqRef) {
  try {
    const mp3 = await generateTTS(text);
    const raw = await convertToPCM16(mp3);
    const buf = fs.readFileSync(raw);
    fs.unlink(mp3, () => {});
    fs.unlink(raw, () => {});

    const CHUNK = 3200;
    let n = 0;
    for (let i = 0; i < buf.length; i += CHUNK) {
      if (ws.readyState !== ws.OPEN) break;
      seqRef.n++;
      n++;
      ws.send(JSON.stringify({
        event: 'media',
        sequence_number: String(seqRef.n),
        stream_sid: streamSid,
        media: { chunk: String(n), timestamp: String(Date.now()), payload: buf.slice(i, i + CHUNK).toString('base64') },
      }));
      await new Promise(r => setTimeout(r, 180));
    }
    ws.send(JSON.stringify({ event: 'mark', stream_sid: streamSid, mark: { name: `done_${Date.now()}` } }));
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.error('[VoiceBot] sendAudio error:', e.message);
  }
}

// ── Fetch schemes + insurance using Groq AI ─────────────────────────────────
async function fetchRecommendations(profile) {
  const { query } = require('../db');

  const age    = profile.age    || 25;
  const income = profile.monthly_income || 0;
  const isBPL  = ['aay','phh'].includes(profile.ration_card_type);
  const isFemale   = profile.gender === 'female';
  const isDisabled = profile.has_disability === true;
  const isWidow    = profile.is_widow === true;
  const isElderly  = age >= 60;
  const isFarmer   = ['farmer','farm_laborer'].includes(profile.occupation);
  const isStudent  = profile.is_student === true;
  const hasGirl    = profile.has_girl_child === true;

  // Fetch schemes from DB — pre-filter by basic eligibility
  const schemeRes = await query(
    `SELECT id, name, description, category, min_age, max_age, max_income, benefit_value, application_url
     FROM schemes WHERE is_active = TRUE
       AND (min_age IS NULL OR min_age <= $1)
       AND (max_age IS NULL OR max_age >= $1)
       AND (max_income IS NULL OR max_income >= $2)
     ORDER BY engagement_weight DESC NULLS LAST LIMIT 40`,
    [age, income]
  );
  const allSchemes = schemeRes.rows;

  // Fetch insurance
  const insRes = await query(
    `SELECT id, name, description, category, annual_premium, coverage_amount, coverage_type, min_age, max_age, application_url
     FROM insurance_policies WHERE is_active = TRUE`
  );
  const allInsurance = insRes.rows;

  let schemes = [], insurance = [];

  if (groq && allSchemes.length > 0) {
    try {
      const schemeList = allSchemes.map((s, i) => {
        const name = typeof s.name === 'object' ? (s.name.en || s.name.hi || 'Scheme') : (s.name || 'Scheme');
        return `${i}|${name}|cat:${s.category}`;
      }).join('\n');

      const prompt = `You are a government scheme eligibility expert for India. Select the 5 MOST RELEVANT schemes for this specific user.

USER PROFILE:
- Age: ${age}
- Gender: ${isFemale ? 'FEMALE' : 'male'}
- Caste: ${profile.caste_category || 'general'}
- Occupation: ${profile.occupation}
- Monthly income: Rs.${income}
- BPL/Poor: ${isBPL ? 'YES - very poor family' : 'no'}
- Ration card: ${profile.ration_card_type || 'none'}
- Disability: ${isDisabled ? 'YES - disabled person' : 'no'}
- Widow: ${isWidow ? 'YES - widow woman' : 'no'}
- Girl child at home: ${hasGirl ? 'YES' : 'no'}
- Student: ${isStudent ? 'YES' : 'no'}
- Financial goal: ${profile.financial_goal}

PRIORITY RULES:
${isFemale ? '- MUST include women-focused schemes (mahila yojana, beti bachao, widow pension, etc.)' : ''}
${isWidow ? '- MUST include widow pension/vidhwa yojana schemes' : ''}
${isDisabled ? '- MUST include disability/divyang schemes' : ''}
${isElderly ? '- MUST include old age pension/senior citizen schemes' : ''}
${isBPL ? '- MUST include BPL/poverty relief schemes like Antyodaya, NFBS, PM Garib Kalyan' : ''}
${isFarmer ? '- MUST include agricultural schemes like PM-KISAN, PMFBY' : ''}
${isStudent || hasGirl ? '- MUST include education/scholarship schemes' : ''}
- Check age eligibility (min_age <= ${age} <= max_age)
- Check income eligibility (max_income >= ${income} or null)

SCHEMES:
${schemeList}

Reply ONLY with JSON array of 5 indices: [3, 7, 12, 0, 5]`;

      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 100,
      });

      const raw   = completion.choices[0]?.message?.content?.trim() || '[]';
      const match = raw.match(/\[[\d,\s]+\]/);
      const indices = match ? JSON.parse(match[0]) : [];
      schemes = indices.filter(i => i >= 0 && i < allSchemes.length).slice(0, 5).map(i => allSchemes[i]);
      console.log('[VoiceBot] Groq selected schemes:', schemes.map(s => typeof s.name === 'object' ? s.name.en : s.name));
    } catch (e) {
      console.error('[VoiceBot] Groq schemes error:', e.message);
    }
  }

  // Fallback DB filter
  if (schemes.length === 0) {
    schemes = allSchemes.filter(s => {
      if (s.min_age && age < s.min_age) return false;
      if (s.max_age && age > s.max_age) return false;
      if (s.max_income && income > s.max_income) return false;
      return true;
    }).slice(0, 5);
  }

  // Insurance with Groq
  if (groq && allInsurance.length > 0) {
    try {
      const insList = allInsurance.map((p, i) => {
        const name = typeof p.name === 'object' ? (p.name.en || p.name.hi || 'Insurance') : (p.name || 'Insurance');
        return `${i}|${name}|premium:Rs.${p.annual_premium}|type:${p.coverage_type}`;
      }).join('\n');

      const prompt = `Select 3 most suitable insurance policies for:
Age: ${age}, Gender: ${isFemale ? 'female' : 'male'}, Income: Rs.${income}/month, BPL: ${isBPL ? 'yes' : 'no'}, Farmer: ${isFarmer ? 'yes' : 'no'}, Has bank account: ${profile.has_bank_account ? 'yes' : 'no'}

Policies:
${insList}

Reply ONLY with JSON array: [0, 2, 4]`;

      const completion = await groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 50,
      });

      const raw = completion.choices[0]?.message?.content?.trim() || '[]';
      const match = raw.match(/\[[\d,\s]+\]/);
      const indices = match ? JSON.parse(match[0]) : [];
      insurance = indices.filter(i => i >= 0 && i < allInsurance.length).map(i => allInsurance[i]);
    } catch (e) {
      console.error('[VoiceBot] Groq insurance error:', e.message);
    }
  }

  if (insurance.length === 0) {
    insurance = allInsurance.filter(p => {
      if (p.min_age && age < p.min_age) return false;
      if (p.max_age && age > p.max_age) return false;
      return true;
    }).slice(0, 3);
  }

  return { schemes, insurance };
}

// ── Hindi number words ──────────────────────────────────────────────────────
const HINDI_NUMS = ['', 'pehli', 'doosri', 'teesri', 'chaurthi', 'paanchvi'];

// ── Translate text to Hindi using Groq ──────────────────────────────────────
async function toHindi(text) {
  if (!text || !groq) return text;
  // If already contains Devanagari, return as-is
  if (/[\u0900-\u097F]/.test(text)) return text;
  try {
    const r = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: `Translate to simple spoken Hindi (Roman/Devanagari mix is fine). Keep numbers as digits. Keep proper nouns as-is. 1 sentence max. Text: "${text.slice(0, 150)}"` }],
      temperature: 0.1,
      max_tokens: 80,
    });
    return r.choices[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

// ── Build result announcement text with Hindi descriptions ──────────────────
async function buildResultText(schemes, insurance, profile) {
  if (schemes.length === 0 && insurance.length === 0) {
    return 'Aapke profile ke liye abhi koi yojana nahi mili. Adhik jankari ke liye arthsathi dot in par jayen. Dhanyawad.';
  }

  let text = '';

  if (schemes.length > 0) {
    text += `Aapke liye ${schemes.length} sarkari yojanaen mili hain. `;
    for (let i = 0; i < schemes.length; i++) {
      const s    = schemes[i];
      const num  = HINDI_NUMS[i + 1] || `${i + 1}wi`;
      const name = typeof s.name === 'object' ? (s.name.hi || s.name.en || 'Yojana') : (s.name || 'Yojana');
      const rawDesc = typeof s.description === 'object' ? (s.description.hi || s.description.en || '') : (s.description || '');
      const hindiDesc = rawDesc ? await toHindi(rawDesc.slice(0, 120)) : '';
      const benefit = s.benefit_value ? `. Labh ${s.benefit_value} rupaye milte hain.` : '.';
      text += `${num} yojana hai ${name}. ${hindiDesc}${benefit} `;
    }
  }

  if (insurance.length > 0) {
    text += `Aur ${insurance.length} beema yojanaen mili hain. `;
    for (let i = 0; i < insurance.length; i++) {
      const p    = insurance[i];
      const num  = HINDI_NUMS[i + 1] || `${i + 1}wa`;
      const name = typeof p.name === 'object' ? (p.name.hi || p.name.en || 'Beema') : (p.name || 'Beema');
      const rawDesc = typeof p.description === 'object' ? (p.description.hi || p.description.en || '') : (p.description || '');
      const hindiDesc = rawDesc ? await toHindi(rawDesc.slice(0, 100)) : '';
      const prem  = p.annual_premium === 0 ? 'yeh muft hai' : `isका praemia sirf ${p.annual_premium} rupaye saalik`;
      const cover = p.coverage_amount ? `. Cover ${(p.coverage_amount / 100000).toFixed(0)} lakh rupaye` : '';
      text += `${num} beema hai ${name}. ${hindiDesc}. ${prem}${cover}. `;
    }
  }

  text += 'Adhik jankari ke liye arthsathi dot in par jayen. Dhanyawad. Jai Hind.';
  return text;
}

// ── Main WebSocket handler ──────────────────────────────────────────────────
function handleVoicebotConnection(ws, req) {
  console.log('[VoiceBot] New connection from:', req.socket.remoteAddress);

  let streamSid   = 'stream_' + Date.now();
  let profile     = {};
  let isClosed    = false;
  let isSpeaking  = false;
  let dtmfTimeout = null;
  const seqRef    = { n: 0 };

  // Get active questions based on current profile answers
  function getActiveQuestions() {
    return QUESTIONS.filter(q => !q.show || q.show(profile));
  }

  let activeQuestions = getActiveQuestions();
  let questionIdx     = 0;

  async function askQuestion() {
    activeQuestions = getActiveQuestions();
    if (isClosed || questionIdx >= activeQuestions.length) {
      if (!isClosed) await handleComplete();
      return;
    }

    if (dtmfTimeout) { clearTimeout(dtmfTimeout); dtmfTimeout = null; }

    const q = activeQuestions[questionIdx];
    console.log(`[VoiceBot] Q${questionIdx}: ${q.key}`);
    isSpeaking = true;
    await sendAudio(ws, q.text, streamSid, seqRef);
    isSpeaking = false;
    console.log(`[VoiceBot] Waiting for DTMF: ${q.key}`);

    // 12s timeout after audio finishes
    dtmfTimeout = setTimeout(async () => {
      if (isClosed || isSpeaking) return;
      console.log('[VoiceBot] No DTMF, repeating');
      isSpeaking = true;
      await sendAudio(ws, 'Kripaya koi button dabain. ' + q.text, streamSid, seqRef);
      isSpeaking = false;
      dtmfTimeout = setTimeout(() => {
        if (!isClosed) { questionIdx++; askQuestion(); }
      }, 12000);
    }, 12000);
  }

  async function handleDTMF(digit) {
    // If bot is speaking, wait for it to finish then process
    if (isSpeaking) {
      const wait = setInterval(() => {
        if (!isSpeaking) { clearInterval(wait); handleDTMF(digit); }
      }, 200);
      return;
    }

    if (dtmfTimeout) { clearTimeout(dtmfTimeout); dtmfTimeout = null; }
    if (isClosed || questionIdx >= activeQuestions.length) return;

    const q = activeQuestions[questionIdx];
    const answer = q.map[digit];

    if (answer === undefined) {
      console.log(`[VoiceBot] Invalid digit "${digit}" for ${q.key}`);
      isSpeaking = true;
      await sendAudio(ws, 'Galat key. ' + q.text, streamSid, seqRef);
      isSpeaking = false;
      return;
    }

    console.log(`[VoiceBot] ${q.key} (${q.profileKey}) = ${answer}`);
    profile[q.profileKey] = answer;
    questionIdx++;
    await askQuestion();
  }

  async function handleComplete() {
    console.log('[VoiceBot] Profile:', JSON.stringify(profile));
    isSpeaking = true;
    await sendAudio(ws, 'Bahut shukriya! Main aapke liye sarkari yojanaen aur beema dhundh rahi hoon. Ek minute.', streamSid, seqRef);

    const { schemes, insurance } = await fetchRecommendations(profile);
    const text = await buildResultText(schemes, insurance, profile);
    await sendAudio(ws, text, streamSid, seqRef);

    isSpeaking = false;
    setTimeout(() => { if (!isClosed) { isClosed = true; ws.close(); } }, 2000);
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === 'connected') {
        console.log('[VoiceBot] Connected');
        return;
      }
      if (msg.event === 'start') {
        streamSid = msg.start?.stream_sid || msg.stream_sid || streamSid;
        console.log('[VoiceBot] Stream started:', streamSid);
        setTimeout(() => askQuestion(), 800);
        return;
      }
      if (msg.event === 'dtmf') {
        const digit = String(msg.dtmf?.digit || '').trim();
        console.log(`[VoiceBot] DTMF: "${digit}"`);
        if (digit) await handleDTMF(digit);
        return;
      }
      if (msg.event === 'media') return; // ignore audio — DTMF only
      if (msg.event === 'stop') {
        console.log('[VoiceBot] Stream stopped');
        isClosed = true;
        if (dtmfTimeout) clearTimeout(dtmfTimeout);
        return;
      }
    } catch {}
  });

  ws.on('close', () => {
    isClosed = true;
    if (dtmfTimeout) clearTimeout(dtmfTimeout);
    console.log('[VoiceBot] Closed');
  });

  ws.on('error', e => {
    console.error('[VoiceBot] Error:', e.message);
    isClosed = true;
  });
}

module.exports = { handleVoicebotConnection };
