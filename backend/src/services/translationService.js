/**
 * ArthSathi — Free Translation Service (MyMemory API)
 *
 * Uses MyMemory Translation API (100% free, 10k requests/day).
 * No API key required. Fast and reliable.
 * Supports: English ↔ Hindi, Marathi, Tamil, Telugu, Bengali
 */

const https = require('https');

// Language code mapping
const LANG_MAP = {
  'hi': 'hi',  // Hindi
  'mr': 'mr',  // Marathi  
  'ta': 'ta',  // Tamil
  'te': 'te',  // Telugu
  'bn': 'bn',  // Bengali
  'en': 'en',  // English
};

/**
 * Translate text using MyMemory free API
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code (hi, mr, ta, te, bn)
 * @returns {Promise<string>} Translated text
 */
async function translate(text, targetLang) {
  // Skip if already target language or no text
  if (!text || !targetLang || targetLang === 'en') {
    return text;
  }

  // Map language code
  const target = LANG_MAP[targetLang] || targetLang;
  
  // Limit text length to avoid URL issues
  const cleanText = text.slice(0, 500);
  
  return new Promise((resolve) => {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=en|${target}`;
    
    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => data += chunk);
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.responseData && parsed.responseData.translatedText) {
            resolve(parsed.responseData.translatedText);
          } else {
            console.warn('[Translation] API returned no translation');
            resolve(text); // Fallback to original
          }
        } catch (err) {
          console.error('[Translation] Parse error:', err.message);
          resolve(text); // Fallback to original
        }
      });
    }).on('error', (err) => {
      console.error('[Translation] Request error:', err.message);
      resolve(text); // Fallback to original
    }).on('timeout', () => {
      console.error('[Translation] Request timeout');
      resolve(text); // Fallback to original
    });
  });
}

/**
 * Translate multiple texts in batch (with delay to avoid rate limiting)
 * @param {string[]} texts - Array of texts to translate
 * @param {string} targetLang - Target language code
 * @returns {Promise<string[]>} Array of translated texts
 */
async function translateBatch(texts, targetLang) {
  if (!texts || texts.length === 0 || targetLang === 'en') {
    return texts;
  }

  const results = [];
  for (const text of texts) {
    results.push(await translate(text, targetLang));
    // Small delay to avoid hitting rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return results;
}

/**
 * Translate a scheme object's name and description
 * @param {Object} scheme - Scheme object
 * @param {string} targetLang - Target language code
 * @returns {Promise<Object>} Scheme with translated fields
 */
async function translateScheme(scheme, targetLang) {
  if (!scheme || targetLang === 'en') {
    return scheme;
  }

  const nameEn = typeof scheme.name === 'object' ? scheme.name.en : scheme.name;
  const descEn = typeof scheme.description === 'object' ? scheme.description.en : scheme.description;

  const [translatedName, translatedDesc] = await Promise.all([
    translate(nameEn, targetLang),
    translate(descEn?.slice(0, 400), targetLang), // Limit desc length
  ]);

  return {
    ...scheme,
    name: translatedName,
    description: translatedDesc,
  };
}

module.exports = { translate, translateBatch, translateScheme };
