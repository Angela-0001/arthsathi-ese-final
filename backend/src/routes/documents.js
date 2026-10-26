/**
 * ArthSathi — Document Safety Checker Routes
 *
 * Uses actual DB table: document_analyses
 * Columns: id, user_id, raw_text, summary, risk_flags (json),
 *          verified, language, high_risk_count, medium_risk_count, created_at
 *
 * POST /api/documents/upload      — upload image, run OCR + risk analysis
 * GET  /api/documents/:id         — fetch document result
 * POST /api/documents/:id/question — ask a follow-up Q&A
 * GET  /api/documents/user/:userId — list user's documents
 * POST /api/documents/analyze     — direct analyze for bots
 */

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { query }           = require('../db');
const { processDocument } = require('../services/ocrService');

const router = express.Router();

// ── Multer config ────────────────────────────────────────────────────────────
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
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/tiff', 'application/pdf'];
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs are supported'));
  },
});

// ── POST /api/documents/upload ───────────────────────────────────────────────
router.post('/upload', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No file uploaded. Please send an image.' } });
    }

    const { user_id, language = 'en' } = req.body;
    if (!user_id) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER', message: 'user_id required' } });
    }

    // Insert pending record — try documents table first, fall back to document_analyses
    let docId;
    try {
      const docResult = await query(
        `INSERT INTO documents (user_id, ocr_language, original_filename, mime_type, created_at)
         VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
        [user_id, language, req.file.originalname, req.file.mimetype]
      );
      docId = docResult.rows[0].id;
    } catch {
      // Fallback to document_analyses table if documents doesn't exist
      const docResult = await query(
        `INSERT INTO document_analyses (user_id, language, verified, high_risk_count, medium_risk_count, created_at)
         VALUES ($1, $2, FALSE, 0, 0, NOW()) RETURNING id`,
        [user_id, language]
      );
      docId = docResult.rows[0].id;
    }

    res.status(202).json({
      success: true,
      document_id: docId,
      status: 'processing',
      message: 'Document received. Processing started.',
    });

    // Run OCR async
    setImmediate(async () => {
      try {
        const ocrResult = await processDocument(req.file.path, language);

        // Check for OCR quality error from Python
        if (ocrResult.error && ocrResult.confidence < 50) {
          try {
            await query(
              `UPDATE documents SET
                summary_text   = $1,
                risk_flags     = $2,
                overall_risk   = 'unknown',
                ocr_confidence = $3,
                processed_at   = NOW()
               WHERE id = $4`,
              [ocrResult.error, JSON.stringify([]), ocrResult.confidence || 0, docId]
            );
          } catch {
            await query(
              `UPDATE document_analyses SET
                summary = $1, risk_flags = $2, verified = TRUE
               WHERE id = $3`,
              [ocrResult.error, JSON.stringify([]), docId]
            ).catch(() => {});
          }
          return;
        }

        const riskFlags   = ocrResult.risk_flags || [];
        const overallRisk = ocrResult.risk_level || (riskFlags.some(f => f.severity === 'high') ? 'high' : riskFlags.some(f => f.severity === 'medium') ? 'medium' : 'low');

        // Try documents table first
        try {
          await query(
            `UPDATE documents SET
              raw_ocr_text   = $1,
              summary_text   = $2,
              risk_flags     = $3,
              overall_risk   = $4,
              ocr_confidence = $5,
              processed_at   = NOW()
             WHERE id = $6`,
            [
              ocrResult.raw_text || '',
              ocrResult.summary  || '',
              JSON.stringify(riskFlags),
              overallRisk,
              ocrResult.confidence || 0,
              docId,
            ]
          );
        } catch {
          // Fallback to document_analyses
          const highCount   = riskFlags.filter(f => f.severity === 'high' || f.severity === 'critical').length;
          const mediumCount = riskFlags.filter(f => f.severity === 'medium').length;
          await query(
            `UPDATE document_analyses SET
              raw_text          = $1,
              summary           = $2,
              risk_flags        = $3,
              high_risk_count   = $4,
              medium_risk_count = $5,
              verified          = TRUE
             WHERE id = $6`,
            [
              ocrResult.raw_text || '',
              ocrResult.summary  || '',
              JSON.stringify(riskFlags),
              highCount,
              mediumCount,
              docId,
            ]
          );
        }
      } catch (e) {
        console.error('[Documents] OCR error:', e.message);
        try {
          await query(`UPDATE documents SET summary_text = $1, processed_at = NOW() WHERE id = $2`,
            [`Error processing document: ${e.message}`, docId]);
        } catch {
          await query(`UPDATE document_analyses SET summary = $1, verified = TRUE WHERE id = $2`,
            [`Error processing document: ${e.message}`, docId]).catch(() => {});
        }
      } finally {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      }
    });

  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(err);
  }
});

// ── GET /api/documents/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    // Try documents table first
    let doc = null;
    let isDocumentsTable = true;
    try {
      const result = await query(
        `SELECT id, user_id, raw_ocr_text, summary_text, risk_flags,
                overall_risk, ocr_confidence, llm_model_used,
                conversation_history, processed_at, created_at
         FROM documents WHERE id = $1`,
        [req.params.id]
      );
      if (result.rows.length) doc = result.rows[0];
    } catch {
      isDocumentsTable = false;
    }

    // Fallback to document_analyses
    if (!doc) {
      const result = await query(
        `SELECT id, user_id, raw_text, summary, risk_flags,
                high_risk_count, medium_risk_count, verified, language, created_at
         FROM document_analyses WHERE id = $1`,
        [req.params.id]
      );
      if (result.rows.length) {
        const r = result.rows[0];
        doc = {
          id: r.id, user_id: r.user_id,
          raw_ocr_text: r.raw_text,
          summary_text: r.summary,
          risk_flags: r.risk_flags || [],
          overall_risk: r.high_risk_count > 0 ? 'high' : r.medium_risk_count > 0 ? 'medium' : 'low',
          ocr_confidence: 0, llm_model_used: null, conversation_history: [],
          processed_at: r.verified ? r.created_at : null,
          created_at: r.created_at,
        };
        isDocumentsTable = false;
      }
    }

    if (!doc) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
    }

    res.json({
      success: true,
      status: doc.processed_at ? 'ready' : 'processing',
      data: {
        id:               doc.id,
        user_id:          doc.user_id,
        summary_text:     doc.summary_text,
        raw_ocr_text:     doc.raw_ocr_text,
        risk_flags:       Array.isArray(doc.risk_flags) ? doc.risk_flags : (typeof doc.risk_flags === 'string' ? JSON.parse(doc.risk_flags) : []),
        overall_risk:     doc.overall_risk || 'low',
        ocr_confidence:   doc.ocr_confidence || 0,
        llm_model_used:   doc.llm_model_used || 'groq',
        conversation_history: doc.conversation_history || [],
        processed_at:     doc.processed_at,
        created_at:       doc.created_at,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/documents/:id/question ────────────────────────────────────────
router.post('/:id/question', async (req, res, next) => {
  try {
    const { question } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_QUESTION', message: 'question required' } });
    }

    // Try documents table first, then document_analyses
    let rawText = null;
    let docLang = 'en';
    try {
      const r = await query('SELECT id, raw_ocr_text, ocr_language FROM documents WHERE id = $1', [req.params.id]);
      if (r.rows.length) { rawText = r.rows[0].raw_ocr_text; docLang = r.rows[0].ocr_language || 'en'; }
    } catch {}
    if (!rawText) {
      const r = await query('SELECT id, raw_text, language FROM document_analyses WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found' } });
      rawText = r.rows[0].raw_text;
      docLang = r.rows[0].language || 'en';
    }

    if (!rawText) {
      return res.status(400).json({ success: false, error: { code: 'NOT_PROCESSED', message: 'Document still processing' } });
    }

    const { answerFromText } = require('../services/ocrService');
    const answer = await answerFromText(rawText, question.trim(), docLang);

    res.json({
      success: true,
      answer,
      conversation_history: [
        { role: 'user',      content: question.trim() },
        { role: 'assistant', content: answer },
      ],
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/documents/user/:userId ─────────────────────────────────────────
router.get('/user/:userId', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, summary, high_risk_count, medium_risk_count, verified, created_at
       FROM document_analyses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [req.params.userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// ── POST /api/documents/analyze (bots) ──────────────────────────────────────
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/analyze', uploadMem.single('file'), async (req, res, next) => {
  let tempPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const lang = req.query.lang || req.body.lang || 'en';
    const ext  = req.file.originalname?.split('.').pop() || 'jpg';
    tempPath   = path.join(os.tmpdir(), `analyze_${Date.now()}.${ext}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    const result = await processDocument(tempPath, lang);

    let summary = result.summary || 'Document processed.';
    if (lang !== 'en') {
      try {
        const { translate } = require('../services/translationService');
        summary = await translate(summary, lang);
      } catch {}
    }

    res.json({
      success:    true,
      summary,
      risk_flags: result.risk_flags || [],
      risk_level: result.risk_level || 'low',
      raw_text:   result.raw_text   || '',
    });
  } catch (err) {
    console.error('[Documents/analyze]', err.message);
    res.status(500).json({
      success:    false,
      summary:    'Could not analyze document. Please send a clearer image.',
      risk_flags: [],
      risk_level: 'unknown',
      error:      err.message,
    });
  } finally {
    if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});
