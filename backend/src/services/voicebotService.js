'use strict';

/**
 * ArthSathi — Exotel WebSocket Voicebot (DTMF-based)
 *
 * Uses DTMF keypad input for reliable answer collection on phone calls.
 * Voice recognition (8kHz) is too degraded for Whisper on PSTN calls.
 *
 * Flow:
 * 1. Ask question with keypad options
 * 2. Listen for DTMF digits
 * 3. Map digit → structured answer
 * 4. After all questions → fetch schemes → read aloud
 */

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { spawn } = require('child_process');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpegLib = require('fluent-ffmpeg');
ffmpegLib.setFfmpegPath(ffmpegInstaller.path);

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const FFMPEG     = ffmpegInstaller.path;

// ── DTMF-based question flow ────────────────────────────────────────────────
const QUESTIONS = [
  {
    key:  'age_group',
    text: 'Aapki umar kitni hai? Ek dabain 18 se 30 saal ke liye. Do dabain 31 se 45 saal ke liye. Teen dabain 46 se 60 saal ke liye. Chaar dabain 60 se upar ke liye.',
    map:  { '1': 25, '2': 38, '3': 53, '4': 65 },
  },
  {
    key:  'gender',
    text: 'Aap purush hain ya mahila? Purush ke liye 1 dabain. Mahila ke liye 2 dabain.',
    map:  { '1': 'male', '2': 'female' },
  },
  {
    key:  'caste',
    text: 'Aapki jaati shreni kya hai? Samanya ke liye 1. OBC ke liye 2. SC ke liye 3. ST ke liye 4.',
    map:  { '1': 'general', '2': 'obc', '3': 'sc', '4': 'st' },
  },
  {
    key:  'occupation',
    text: 'Aap kya kaam karte hain? Kisan ke liye 1. Khet mazdoor ke liye 2. Dihadi mazdoor ke liye 3. Swa-rozgar ke liye 4. Nirman mazdoor ke liye 5.',
    map:  { '1': 'farmer', '2': 'farm_laborer', '3': 'daily_wage_worker', '4': 'self_employed', '5': 'construction_worker' },
  },
  {
    key:  'income',
    text: 'Aap har mahine kitna kamate hain? Ek dabain 5000 se kam ke liye. Do dabain 5000 se 10000 ke liye. Teen dabain 10000 se 20000 ke liye. Chaar dabain 20000 se zyada ke liye.',
    map:  { '1': 3000, '2': 7500, '3': 15000, '4': 25000 },
  },
  {
    key:  'bpl',
    text: 'Kya aapke paas BPL card hai? Haan ke liye 1 dabain. Nahin ke liye 2 dabain.',
    map:  { '1': true, '2': false },
  },
];

// ── Generate TTS MP3 using gTTS ─────────────────────────────────────────────
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
      else reject(new Error(`TTS failed: ${err.slice(0, 200)}`));
    });
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); reject(new Error('TTS timeout')); }, 30000);
  });
}

// ── Convert MP3 → PCM16 8kHz mono ──────────────────────────────────────────
function convertToPCM16(inputPath) {
  return new Promise((resolve, reject) => {
    const outputPath = inputPath.replace('.mp3', '.raw');
    const proc = spawn(FFMPEG, ['-y', '-i', inputPath, '-ar', '8000', '-ac', '1', '-f', 's16le', outputPath]);
    let err = '';
    proc.stderr.on('data', c => err += c.toString());
    proc.on('close', code => {
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`ffmpeg failed: ${err.slice(-200)}`));
    });
    proc.on('error', e => reject(new Error(`ffmpeg spawn: ${e.message}`)));
    setTimeout(() => { proc.kill(); reject(new Error('ffmpeg timeout')); }, 30000);
  });
}

// ── Send TTS audio to caller ────────────────────────────────────────────────
async function sendAudio(ws, text, streamSid, seqRef) {
  try {
    const mp3Path = await generateTTS(text);
    const rawPath = await convertToPCM16(mp3Path);
    const rawData = fs.readFileSync(rawPath);
    fs.unlink(mp3Path, () => {});
    fs.unlink(rawPath, () => {});

    const CHUNK = 3200;
    let count = 0;
    for (let i = 0; i < rawData.length; i += CHUNK) {
      if (ws.readyState !== ws.OPEN) break;
      const chunk = rawData.slice(i, i + CHUNK);
      seqRef.n++;
      count++;
      ws.send(JSON.stringify({
        event:           'media',
        sequence_number: String(seqRef.n),
        stream_sid:      streamSid,
        media: { chunk: String(count), timestamp: String(Date.now()), payload: chunk.toString('base64') },
      }));
      await new Promise(r => setTimeout(r, 180));
    }
    console.log(`[VoiceBot] Sent ${count} chunks (${rawData.length} bytes)`);

    const markName = `done_${Date.now()}`;
    ws.send(JSON.stringify({ event: 'mark', stream_sid: streamSid, mark: { name: markName } }));
    await new Promise(r => setTimeout(r, 300));
  } catch (e) {
    console.error('[VoiceBot] sendAudio error:', e.message);
  }
}

// ── Fetch schemes ───────────────────────────────────────────────────────────
async function fetchSchemes(profile) {
  const { query } = require('../db');
  try {
    const age    = parseInt(profile.age_group) || 25;
    const income = parseInt(profile.income)    || 0;
    const result = await query(
      `SELECT name, benefit_value FROM schemes
       WHERE is_active = TRUE
         AND (min_age IS NULL OR min_age <= $1)
         AND (max_age IS NULL OR max_age >= $1)
         AND (max_income IS NULL OR max_income >= $2)
       ORDER BY engagement_weight DESC NULLS LAST LIMIT 3`,
      [age, income]
    );
    return result.rows;
  } catch (e) {
    console.error('[VoiceBot] DB error:', e.message);
    return [];
  }
}

// ── Main WebSocket handler ──────────────────────────────────────────────────
function handleVoicebotConnection(ws, req) {
  console.log('[VoiceBot] New connection from:', req.socket.remoteAddress);

  let streamSid   = 'stream_' + Date.now();
  let questionIdx = 0;
  let profile     = {};
  let isClosed    = false;
  let isSpeaking  = false;
  let dtmfTimeout = null;
  const seqRef    = { n: 0 };

  async function askQuestion() {
    if (isClosed || questionIdx >= QUESTIONS.length) {
      if (!isClosed) await handleComplete();
      return;
    }

    if (dtmfTimeout) { clearTimeout(dtmfTimeout); dtmfTimeout = null; }

    const q = QUESTIONS[questionIdx];
    console.log(`[VoiceBot] Q${questionIdx}: ${q.key}`);
    isSpeaking = true;
    await sendAudio(ws, q.text, streamSid, seqRef);
    isSpeaking = false;
    console.log(`[VoiceBot] Waiting for DTMF on: ${q.key}`);

    // Only start timeout AFTER audio finishes
    dtmfTimeout = setTimeout(async () => {
      if (isClosed || isSpeaking) return;
      console.log('[VoiceBot] No DTMF, repeating question once');
      isSpeaking = true;
      await sendAudio(ws, 'Kripaya koi button dabain. ' + q.text, streamSid, seqRef);
      isSpeaking = false;
      dtmfTimeout = setTimeout(() => {
        if (!isClosed && !isSpeaking) {
          console.log('[VoiceBot] Still no input, moving on');
          handleComplete();
        }
      }, 15000);
    }, 12000);
  }

  async function handleDTMF(digit) {
    if (isSpeaking) {
      console.log(`[VoiceBot] DTMF ${digit} received while speaking, buffering`);
      // Wait for speaking to finish then process
      const waitForSpeech = setInterval(() => {
        if (!isSpeaking) {
          clearInterval(waitForSpeech);
          handleDTMF(digit);
        }
      }, 200);
      return;
    }
    if (dtmfTimeout) { clearTimeout(dtmfTimeout); dtmfTimeout = null; }
    if (isClosed || questionIdx >= QUESTIONS.length) return;

    const q = QUESTIONS[questionIdx];
    const answer = q.map[digit];

    if (answer === undefined) {
      console.log(`[VoiceBot] Invalid digit ${digit} for ${q.key}`);
      await sendAudio(ws, `Galat key. ${q.text}`, streamSid, seqRef);
      isSpeaking = false;
      return;
    }

    console.log(`[VoiceBot] ${q.key} = ${answer} (digit: ${digit})`);
    profile[q.key] = answer;
    questionIdx++;
    await askQuestion();
  }

  async function handleComplete() {
    console.log('[VoiceBot] Profile collected:', profile);
    isSpeaking = true;
    await sendAudio(ws, 'Shukriya. Main aapke liye sarkari yojanaen dhundh rahi hoon. Ek minute.', streamSid, seqRef);

    const schemes = await fetchSchemes(profile);
    let text;
    if (!schemes.length) {
      text = 'Aapke profile ke liye abhi koi yojana nahi mili. Adhik jankari ke liye arthsathi dot in par jayen. Dhanyawad.';
    } else {
      text = `Aapke liye ${schemes.length} sarkari yojanaen mili hain. `;
      schemes.forEach((s, i) => {
        const name = typeof s.name === 'object' ? (s.name.hi || s.name.en || 'Yojana') : (s.name || 'Yojana');
        text += `${i + 1}. ${name}. `;
      });
      text += 'Adhik jankari ke liye arthsathi dot in par jayen. Dhanyawad. Jai Hind.';
    }

    await sendAudio(ws, text, streamSid, seqRef);
    setTimeout(() => { if (!isClosed) { isClosed = true; ws.close(); } }, 2000);
  }

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.event === 'connected') {
        console.log('[VoiceBot] Connected — waiting for start');
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

      // Ignore all media events — we use DTMF only
      if (msg.event === 'media') return;

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
    console.log('[VoiceBot] Connection closed');
  });

  ws.on('error', e => {
    console.error('[VoiceBot] Error:', e.message);
    isClosed = true;
  });
}

module.exports = { handleVoicebotConnection };
