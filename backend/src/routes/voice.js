/**
 * ArthSathi — Voice API Routes
 *
 * POST /api/voice/stt      — speech-to-text (upload WebM audio)
 * POST /api/voice/tts      — text-to-speech (returns WAV audio)
 * POST /api/voice/translate — translate text between languages
 */

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { speechToText, textToSpeech, translateText } = require('../services/voiceService');

const router = express.Router();

// Audio upload config — stored in OS temp dir
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `audio_${Date.now()}${ext}`);
  },
});

const uploadAudio = multer({
  storage: audioStorage,
  limits:  { fileSize: 25 * 1024 * 1024 }, // 25 MB max
  fileFilter: (req, file, cb) => {
    const ok = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4',
                'audio/x-m4a', 'application/octet-stream'].includes(file.mimetype);
    cb(ok ? null : new Error('Audio file type not supported'), ok);
  },
});

// ---------------------------------------------------------------------------
// POST /api/voice/stt
// ---------------------------------------------------------------------------
router.post('/stt', uploadAudio.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'NO_AUDIO', message: 'Audio file required' } });
    }

    const language = req.body.language || 'hi';
    const result   = await speechToText(req.file.path, language);

    // Clean up temp audio file
    fs.unlink(req.file.path, () => {});

    res.json({ success: result.success, text: result.text || '', language: result.language, error: result.error });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/voice/tts
// ---------------------------------------------------------------------------
router.post('/tts', async (req, res, next) => {
  try {
    const { text, language = 'hi' } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: { code: 'NO_TEXT', message: 'text required' } });
    }

    const result = await textToSpeech(text.slice(0, 1000), language); // limit TTS length

    if (!result.success || !result.output_path) {
      return res.status(500).json({
        success: false,
        error: { code: 'TTS_FAILED', message: result.error || 'TTS failed' },
      });
    }

    // Stream WAV back to client
    const wavPath = result.output_path;
    if (!fs.existsSync(wavPath)) {
      return res.status(500).json({ success: false, error: { code: 'NO_OUTPUT', message: 'TTS output file missing' } });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline; filename="tts.wav"');

    const stream = fs.createReadStream(wavPath);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(wavPath, () => {}));
    stream.on('error', next);

  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/voice/translate
// ---------------------------------------------------------------------------
router.post('/translate', async (req, res, next) => {
  try {
    const { text, src_lang = 'en', tgt_lang = 'hi' } = req.body;
    if (!text) {
      return res.status(400).json({ success: false, error: { code: 'NO_TEXT', message: 'text required' } });
    }

    const result = await translateText(text, src_lang, tgt_lang);
    res.json({
      success: result.success !== false,
      translated_text: result.translated_text || text,
      model: result.model,
      error: result.error,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
