/**
 * ArthSathi — Voice Service (Node.js side)
 *
 * Routes speech-to-text and text-to-speech requests to the Python
 * voice_processor.py subprocess. The Express routes call these helpers.
 *
 * STT: Browser records WebM/OGG audio → uploaded to /api/voice/stt →
 *      spawns Whisper → returns transcript text
 *
 * TTS: Text + language → spawns pyttsx3/Piper → returns WAV audio file
 *      path → streamed back to client as audio/wav
 */

const { spawn } = require('child_process');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');

const PYTHON_BIN   = process.env.PYTHON_BIN   || 'python';
const VOICE_SCRIPT = path.join(__dirname, '../../../ml-model/voice_processor.py');

/**
 * Run Whisper STT on an audio file.
 * @param {string} audioPath — path to audio file (WebM, OGG, WAV, MP3)
 * @param {string} language  — language code
 * @returns {Promise<{text: string, language: string, success: boolean}>}
 */
function speechToText(audioPath, language = 'hi') {
  return spawnVoiceProcessor(['--mode', 'stt', '--audio', audioPath, '--lang', language]);
}

/**
 * Generate speech from text.
 * @param {string} text      — text to speak
 * @param {string} language  — language code
 * @returns {Promise<{output_path: string, engine: string, success: boolean}>}
 */
function textToSpeech(text, language = 'hi') {
  const outputPath = path.join(os.tmpdir(), `tts_${Date.now()}.wav`);
  return spawnVoiceProcessor([
    '--mode', 'tts',
    '--text', text,
    '--lang', language,
    '--output', outputPath,
  ]);
}

/**
 * Translate text between languages.
 * @param {string} text     — text to translate
 * @param {string} srcLang  — source language code
 * @param {string} tgtLang  — target language code
 */
function translateText(text, srcLang = 'en', tgtLang = 'hi') {
  return spawnVoiceProcessor([
    '--mode', 'translate',
    '--text', text,
    '--src',  srcLang,
    '--tgt',  tgtLang,
  ]);
}

/**
 * Internal helper: spawns voice_processor.py with given args.
 */
function spawnVoiceProcessor(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [VOICE_SCRIPT, ...args]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', c => stdout += c.toString());
    proc.stderr.on('data', c => stderr += c.toString());

    proc.on('close', () => {
      try {
        const jsonStart = stdout.indexOf('{');
        if (jsonStart === -1) {
          return resolve({ success: false, error: 'No JSON from voice processor', text: '' });
        }
        const result = JSON.parse(stdout.slice(jsonStart));
        resolve(result);
      } catch (e) {
        resolve({ success: false, error: `Parse error: ${e.message}`, text: '' });
      }
    });

    proc.on('error', err => {
      resolve({ success: false, error: err.message, text: '' });
    });

    // TTS timeout: 60s; STT timeout: 120s
    const timeout = args.includes('--mode') && args[args.indexOf('--mode') + 1] === 'stt' ? 120_000 : 60_000;
    setTimeout(() => { proc.kill(); resolve({ success: false, error: 'Voice processing timed out', text: '' }); }, timeout);
  });
}

module.exports = { speechToText, textToSpeech, translateText };
