/**
 * ArthSathi — i18n API Route
 *
 * Serves translation files from the shared i18n/ folder.
 * GET /api/i18n/:lang/questions  — returns questions.json for that language
 *
 * Falls back to English if the language file doesn't exist.
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const router = express.Router();

const I18N_DIR = path.join(__dirname, '../../../i18n');

router.get('/:lang/questions', (req, res) => {
  const { lang } = req.params;
  const allowed  = ['hi', 'mr', 'ta', 'te', 'bn', 'en'];

  if (!allowed.includes(lang)) {
    return res.status(400).json({ error: 'Unsupported language' });
  }

  const filePath = path.join(I18N_DIR, lang, 'questions.json');
  const fallback = path.join(I18N_DIR, 'en', 'questions.json');

  const target = fs.existsSync(filePath) ? filePath : fallback;

  try {
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Could not load translations' });
  }
});

// List available languages
router.get('/languages', (req, res) => {
  res.json({
    languages: [
      { code: 'hi', name: 'Hindi',   native: 'हिंदी' },
      { code: 'mr', name: 'Marathi', native: 'मराठी' },
      { code: 'ta', name: 'Tamil',   native: 'தமிழ்' },
      { code: 'te', name: 'Telugu',  native: 'తెలుగు' },
      { code: 'bn', name: 'Bengali', native: 'বাংলা' },
      { code: 'en', name: 'English', native: 'English' },
    ],
  });
});

module.exports = router;
