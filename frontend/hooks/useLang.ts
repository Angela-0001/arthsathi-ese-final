'use client';
import { useState, useEffect } from 'react';
import { initLanguage, currentLanguage, type LanguageCode } from '@/i18n';

/**
 * Hook that returns current language and triggers re-render on language change.
 * Use this in any component that needs to react to language switches.
 */
export function useLang(): LanguageCode {
  const [lang, setLang] = useState<LanguageCode>('hi');

  useEffect(() => {
    initLanguage();
    setLang(currentLanguage());

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'arthsathi_lang') {
        initLanguage();
        setLang(currentLanguage());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return lang;
}