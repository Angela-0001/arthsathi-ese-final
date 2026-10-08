/**
 * ArthSathi — Unified i18n engine
 *
 * Loads questions + UI strings from the shared i18n/ folder.
 * In the browser, files are fetched lazily from /api/i18n/:lang.
 * This module also handles the language → locale mapping for TTS/STT.
 */

export type LangCode = 'hi' | 'mr' | 'ta' | 'te' | 'bn' | 'en';

export const LANGUAGES: Record<LangCode, { name: string; native: string; ttsLocale: string; whisperCode: string }> = {
  hi: { name: 'Hindi',   native: 'हिंदी',    ttsLocale: 'hi-IN', whisperCode: 'hi' },
  mr: { name: 'Marathi', native: 'मराठी',    ttsLocale: 'mr-IN', whisperCode: 'mr' },
  ta: { name: 'Tamil',   native: 'தமிழ்',    ttsLocale: 'ta-IN', whisperCode: 'ta' },
  te: { name: 'Telugu',  native: 'తెలుగు',   ttsLocale: 'te-IN', whisperCode: 'te' },
  bn: { name: 'Bengali', native: 'বাংলা',    ttsLocale: 'bn-IN', whisperCode: 'bn' },
  en: { name: 'English', native: 'English',   ttsLocale: 'en-IN', whisperCode: 'en' },
};

// In-memory cache of loaded translations
const cache: Record<string, Record<string, unknown>> = {};

/**
 * Load question translations for a language.
 * Returns the questions JSON for that language, falling back to English.
 */
export async function loadQuestions(lang: LangCode): Promise<Record<string, unknown>> {
  if (cache[lang]) return cache[lang];

  try {
    const res = await fetch(`/api/i18n/${lang}/questions`);
    if (res.ok) {
      const data = await res.json();
      cache[lang] = data;
      return data;
    }
  } catch { /* fallback */ }

  // Fallback: load English
  if (lang !== 'en') return loadQuestions('en');
  return {};
}

/**
 * Get a translated string from a loaded questions object.
 * Supports dot notation: get(data, 'occupation.question')
 */
export function get(
  data: Record<string, unknown>,
  path: string,
  vars?: Record<string, string | number>
): string {
  const parts = path.split('.');
  let curr: unknown = data;
  for (const p of parts) {
    if (curr && typeof curr === 'object' && p in (curr as Record<string, unknown>)) {
      curr = (curr as Record<string, unknown>)[p];
    } else {
      return path; // return key if not found
    }
  }
  let text = typeof curr === 'string' ? curr : path;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }
  return text;
}

/** Persist chosen language to localStorage and document */
export function setLanguage(lang: LangCode) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('as_lang', lang);
  document.documentElement.lang = lang;
}

/** Read persisted language */
export function getSavedLanguage(): LangCode {
  if (typeof window === 'undefined') return 'hi';
  return (localStorage.getItem('as_lang') as LangCode) || 'hi';
}

/** Persist interaction mode */
export function setMode(mode: 'text' | 'voice') {
  if (typeof window === 'undefined') return;
  localStorage.setItem('as_mode', mode);
}

export function getSavedMode(): 'text' | 'voice' {
  if (typeof window === 'undefined') return 'voice';
  return (localStorage.getItem('as_mode') as 'text' | 'voice') || 'voice';
}
