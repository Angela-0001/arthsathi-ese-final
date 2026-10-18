/**
 * ArthSathi — Document Safety Checker Routes
 *
 * POST /api/documents/upload      — upload image, run OCR + risk analysis
 * GET  /api/documents/:id         — fetch document result
 * POST /api/documents/:id/question — ask a follow-up question
 * GET  /api/documents/user/:userId — list user's documents
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { query }          = require('../db');
const { processDocument } = require('../services/ocrService');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer upload config
// ---------------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `doc_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP) are accepted'));
    }
  },
});

// ---------------------------------------------------------------------------
// POST /api/documents/upload
// ---------------------------------------------------------------------------
router.post('/upload', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No image file uploaded' } });
    }

    const { user_id, language = 'en' } = req.body;
    if (!user_id) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER', message: 'user_id required' } });
    }

    // Create pending document record
    const docResult = await query(
      `INSERT INTO documents (user_id, original_filename, file_path, mime_type, ocr_language)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [user_id, req.file.originalname, req.file.path, req.file.mimetype, language]
    );
    const docId = docResult.rows[0].id;

    // Respond immediately so the client shows a processing state
    res.status(202).json({
      success: true,
      document_id: docId,
      status: 'processing',
      message: 'Document received. Processing started.',
    });

    // Run OCR async — update DB when done
    setImmediate(async () => {
      try {
        const ocrResult = await processDocument(req.file.path, language);

        const riskLevel = ocrResult.risk_level || 'low';
        await query(
          `UPDATE documents SET
            raw_ocr_text    = $1,
            ocr_confidence  = $2,
            summary_text    = $3,
            summary_language = $4,
            risk_flags      = $5,
            risk_level      = $6::risk_level,
            llm_model_used  = $7,
            processed_at    = NOW(),
            updated_at      = NOW()
           WHERE id = $8`,
          [
            ocrResult.raw_text,
            ocrResult.confidence,
            ocrResult.summary,
            language,
            JSON.stringify(ocrResult.risk_flags),
            riskLevel,
            ocrResult.llm_used,
            docId,
          ]
        );
      } catch (e) {
        console.error('[Documents] OCR background error:', e.message);
        await query(
          `UPDATE documents SET summary_text = $1, processed_at = NOW() WHERE id = $2`,
          [`Error processing document: ${e.message}`, docId]
        ).catch(() => {});
      }
    });

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/documents/:id — poll for document result
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, user_id, original_filename, ocr_confidence, summary_text, summary_language, risk_flags, risk_level, llm_model_used, processed_at, created_at FROM documents WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const doc = result.rows[0];
    const isReady = doc.processed_at !== null;

    res.json({
      success: true,
      status: isReady ? 'ready' : 'processing',
      data: doc,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/documents/:id/question — follow-up Q&A
// ---------------------------------------------------------------------------
router.post('/:id/question', async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question || !question.trim()) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_QUESTION', message: 'question required' } });
    }

    const docResult = await query(
      'SELECT id, raw_ocr_text, summary_language, conversation_history FROM documents WHERE id = $1',
      [req.params.id]
    );
    if (docResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    const doc = docResult.rows[0];
    if (!doc.raw_ocr_text) {
      return res.status(400).json({ success: false, error: { code: 'NOT_PROCESSED', message: 'Document still processing' } });
    }

    // Write temp file with OCR text for Python to read
    const tmpPath = path.join(UPLOAD_DIR, `text_${doc.id}.txt`);
    fs.writeFileSync(tmpPath, doc.raw_ocr_text);

    const { processDocument: proc } = require('../services/ocrService');

    // Use a 1x1 white pixel as placeholder image (Python will get text from file param)
    // Actually we pass it directly via question mode on the existing image
    // For simplicity, use the rule-based answer here and call Python only if Ollama available
    const { answerFromText } = require('../services/ocrService');

    // Inline fallback Q&A
    const answer = await answerFromText(doc.raw_ocr_text, question.trim(), doc.summary_language || 'en');

    // Persist conversation history
    const history = doc.conversation_history || [];
    history.push({ role: 'user',      content: question.trim() });
    history.push({ role: 'assistant', content: answer });

    await query(
      'UPDATE documents SET conversation_history = $1 WHERE id = $2',
      [JSON.stringify(history), doc.id]
    );

    // Clean up temp file
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    res.json({ success: true, answer, conversation_history: history });

  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/documents/user/:userId — list user's documents
// ---------------------------------------------------------------------------
router.get('/user/:userId', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, original_filename, risk_level, summary_text, processed_at, created_at
       FROM documents WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// ---------------------------------------------------------------------------
// POST /api/documents/analyze — direct analyze for bots (Telegram/WhatsApp)
// Accepts multipart file, runs OCR inline, returns result immediately
// ---------------------------------------------------------------------------
const uploadAny = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post('/analyze', uploadAny.single('file'), async (req, res, next) => {
  let tempPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const lang = req.query.lang || req.body.lang || 'en';

    // Write buffer to temp file
    const os  = require('os');
    const ext = req.file.originalname?.split('.').pop() || 'jpg';
    tempPath  = path.join(os.tmpdir(), `analyze_${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    const result = await processDocument(tempPath, lang);

    // Translate summary if language is not English
    let translatedSummary = result.summary || 'Document processed.';
    if (lang !== 'en') {
      const { translate } = require('../services/translationService');
      translatedSummary = await translate(result.summary || 'Document processed.', lang);
    }

    res.json({
      success:    true,
      summary:    translatedSummary,
      risk_flags: result.risk_flags || [],
      risk_level: result.risk_level || 'low',
      raw_text:   result.raw_text   || '',
    });

  } catch (err) {
    console.error('[Documents/analyze]', err.message);
    
    // Translate error message if language is not English
    let errorMsg = 'Could not analyze document. Please send a clearer image.';
    if (req.query.lang !== 'en' && req.body.lang !== 'en') {
      const { translate } = require('../services/translationService');
      errorMsg = await translate(errorMsg, req.query.lang || req.body.lang);
    }
    
    res.status(500).json({
      success:    false,
      summary:    errorMsg,
      risk_flags: [],
      risk_level: 'unknown',
      error:      err.message,
    });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});
