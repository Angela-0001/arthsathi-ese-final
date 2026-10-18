/**
 * ArthSathi — Language Switcher Component
 *
 * Dropdown to switch between Hindi, Marathi, Tamil, Telugu, Bengali, English.
 * Updates localStorage and triggers full UI re-render.
 */

'use client';

import { useState, useEffect } from 'react';
import { setLanguage, currentLanguage, LANGUAGES, type LanguageCode } from '@/i18n';

export default function LanguageSwitcher() {
  const [lang, setLang] = useState<LanguageCode>('hi');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Initialize language from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('arthsathi_lang') as LanguageCode | null;
      if (saved && saved in LANGUAGES) {
        setLang(saved);
      }
    }
  }, []);

  const handleChange = (newLang: LanguageCode) => {
    setLang(newLang);
    setLanguage(newLang);
    setIsOpen(false);
    
    // Force page reload to apply translations throughout the app
    window.location.reload();
  };

  const currentLangData = LANGUAGES[lang];

  return (
    <div className="relative inline-block text-left">
      {/* Language selector button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors"
        aria-label="Select language"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg
          className="w-5 h-5 text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
          />
        </svg>
        <span className="font-medium text-gray-700">{currentLangData.nativeName}</span>
        <svg
          className={`w-4 h-4 text-gray-600 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Dropdown list */}
          <div className="absolute right-0 mt-2 w-48 rounded-lg bg-white shadow-lg ring-1 ring-black ring-opacity-5 z-20">
            <div className="py-1" role="menu" aria-orientation="vertical">
              {(Object.keys(LANGUAGES) as LanguageCode[]).map((code) => {
                const langData = LANGUAGES[code];
                const isSelected = code === lang;

                return (
                  <button
                    key={code}
                    onClick={() => handleChange(code)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      isSelected
                        ? 'bg-primary text-white font-semibold'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                    role="menuitem"
                  >
                    <div className="flex items-center justify-between">
                      <span>{langData.nativeName}</span>
                      {isSelected && (
                        <svg
                          className="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{langData.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
