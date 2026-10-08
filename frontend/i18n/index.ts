/**
 * ArthSathi — Multilingual Translation System
 *
 * Architecture:
 * - Each language is a flat key→value map in its own file.
 * - Adding a new language = adding one file + registering it here.
 * - No language is hardcoded as a fallback in logic; 'hi' (Hindi) is
 *   the UI default but this is a configuration value, not a code assumption.
 * - Keys use dot notation (e.g. "onboarding.name_question") for organisation.
 *
 * Usage:
 *   import { t, setLanguage, currentLanguage } from '@/i18n';
 *   t('onboarding.name_question')  // returns translated string
 */

import hi from './hi';
import mr from './mr';
import ta from './ta';
import te from './te';
import bn from './bn';
import en from './en';

export type LanguageCode = 'hi' | 'mr' | 'ta' | 'te' | 'bn' | 'en';

// Registry of all supported languages. Add a new entry to support a new language.
export const LANGUAGES: Record<LanguageCode, { name: string; nativeName: string; rtl: boolean }> = {
  hi: { name: 'Hindi',   nativeName: 'हिंदी',       rtl: false },
  mr: { name: 'Marathi', nativeName: 'मराठी',       rtl: false },
  ta: { name: 'Tamil',   nativeName: 'தமிழ்',       rtl: false },
  te: { name: 'Telugu',  nativeName: 'తెలుగు',      rtl: false },
  bn: { name: 'Bengali', nativeName: 'বাংলা',       rtl: false },
  en: { name: 'English', nativeName: 'English',      rtl: false },
};

const translations: Record<LanguageCode, Record<string, string>> = { hi, mr, ta, te, bn, en };

// Current active language (read from localStorage on client, default: 'hi')
let _currentLang: LanguageCode = 'hi';

export const setLanguage = (lang: LanguageCode) => {
  _currentLang = lang;
  if (typeof window !== 'undefined') {
    localStorage.setItem('arthsathi_lang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = LANGUAGES[lang].rtl ? 'rtl' : 'ltr';
  }
};

export const initLanguage = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('arthsathi_lang') as LanguageCode | null;
    if (saved && saved in LANGUAGES) {
      _currentLang = saved;
      document.documentElement.lang = saved;
    }
  }
};

export const currentLanguage = (): LanguageCode => _currentLang;

/**
 * Translate a key in the current language.
 * Falls back to English, then returns the key itself if not found anywhere.
 *
 * Supports simple interpolation: t('greeting', { name: 'Ramesh' })
 * with template "नमस्ते {{name}}!" → "नमस्ते Ramesh!"
 */
export const t = (key: string, vars?: Record<string, string | number>): string => {
  const langMap = translations[_currentLang] || {};
  const fallback = translations['en'] || {};
  let text = langMap[key] || fallback[key] || key;

  if (vars) {
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    });
  }

  return text;
};

export default { t, setLanguage, initLanguage, currentLanguage, LANGUAGES };
