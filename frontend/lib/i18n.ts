/**
 * ArthSathi — lib/i18n.ts
 * Re-exports from @/i18n (single source of truth) and adds
 * loadQuestions / get helpers used by the onboarding page.
 * Languages: Hindi (hi), Marathi (mr), English (en) only.
 */

// Re-export everything from the canonical i18n module
export type { LanguageCode } from '@/i18n';
export { LANGUAGES, t, setLanguage, initLanguage, currentLanguage } from '@/i18n';

// LangCode is an alias so onboarding doesn't need to change its import name
export type LangCode = 'hi' | 'mr' | 'en';

// Consistent localStorage key (must match i18n/index.ts)
const LANG_KEY = 'arthsathi_lang';
const MODE_KEY = 'arthsathi_mode';

/** Persist chosen language */
export function setLanguageLib(lang: LangCode) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
}

/** Read persisted language */
export function getSavedLanguage(): LangCode {
  if (typeof window === 'undefined') return 'hi';
  return (localStorage.getItem(LANG_KEY) as LangCode) || 'hi';
}

/** Persist interaction mode */
export function setMode(mode: 'text' | 'voice') {
  if (typeof window === 'undefined') return;
  localStorage.setItem(MODE_KEY, mode);
}

/** Read persisted interaction mode (supports both old and new keys) */
export function getSavedMode(): 'text' | 'voice' {
  if (typeof window === 'undefined') return 'voice';
  const v = localStorage.getItem(MODE_KEY) || localStorage.getItem('as_mode');
  return (v as 'text' | 'voice') || 'voice';
}

// In-memory cache of loaded question translations
const cache: Record<string, Record<string, unknown>> = {};

/**
 * Load question translations for a language from the backend API.
 * Falls back to English if the requested language is unavailable.
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
      return path;
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
