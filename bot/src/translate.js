import https from "https";

/**
 * Translate text using MyMemory free API
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code (hi, mr, ta, te, bn)
 * @returns {Promise<string>} Translated text
 */
export async function translate(text, targetLang) {
  if (!text || !targetLang || targetLang === 'en') {
    return text;
  }

  const cleanText = text.slice(0, 500);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanText)}&langpair=en|${targetLang}`;

  return new Promise((resolve) => {
    https.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.responseData?.translatedText) {
            resolve(parsed.responseData.translatedText);
          } else {
            resolve(text);
          }
        } catch (err) {
          resolve(text);
        }
      });
    }).on('error', () => resolve(text))
      .on('timeout', () => resolve(text));
  });
}

/**
 * Detect language from text (simple heuristic)
 */
export function detectLanguage(text) {
  if (!text) return 'en';
  const devanagari = /[\u0900-\u097F]/;
  if (devanagari.test(text)) {
    const marathiWords = /आहे|आहेत|मला|तुम्ही|नाही|कृपया/;
    return marathiWords.test(text) ? 'mr' : 'hi';
  }
  return 'en';
}
