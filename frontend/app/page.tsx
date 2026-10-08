/**
 * ArthSathi — Landing Page
 *
 * First screen the user sees. Designed for:
 * - Low-literacy users: large icons, minimal text, clear CTA
 * - Slow connections: no heavy images, all inline SVG icons
 * - All languages: text is loaded from i18n keys
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, initLanguage, currentLanguage, LANGUAGES, type LanguageCode } from '../i18n';

export default function LandingPage() {
  const router = useRouter();
  const [lang, setLang] = useState<LanguageCode>('hi');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    initLanguage();
    setLang(currentLanguage());
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const features = [
    {
      icon: '🌾',
      titleKey: 'landing.feature_1_title',
      descKey: 'landing.feature_1_desc',
      color: 'bg-green-50 border-green-200',
    },
    {
      icon: '🛡️',
      titleKey: 'landing.feature_2_title',
      descKey: 'landing.feature_2_desc',
      color: 'bg-blue-50 border-blue-200',
    },
    {
      icon: '📄',
      titleKey: 'landing.feature_3_title',
      descKey: 'landing.feature_3_desc',
      color: 'bg-amber-50 border-amber-200',
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary to-primary-light flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-10 pb-4">
        <div className="text-white">
          <h1 className="text-3xl font-bold">{t('app.name')}</h1>
          <p className="text-white/80 text-base">{t('app.tagline')}</p>
        </div>
        {/* Language selector — always visible */}
        <div className="relative">
          <select
            className="appearance-none bg-white/20 text-white border border-white/30
                       rounded-xl px-3 py-2 text-base font-medium cursor-pointer
                       focus:outline-none focus:ring-2 focus:ring-white/50 min-h-[48px]"
            value={lang}
            onChange={(e) => {
              const newLang = e.target.value as LanguageCode;
              setLang(newLang);
              import('../i18n').then(({ setLanguage }) => {
                setLanguage(newLang);
                router.refresh();
              });
            }}
            aria-label="Select language"
          >
            {(Object.entries(LANGUAGES) as [LanguageCode, { nativeName: string }][]).map(([code, info]) => (
              <option key={code} value={code} className="text-gray-900 bg-white">
                {info.nativeName}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Hero section */}
      <section className="flex-1 flex flex-col items-center justify-center px-5 py-8 text-center">
        <div className="text-7xl mb-6" role="img" aria-label="ArthSathi logo">🌱</div>
        <h2 className="text-3xl font-bold text-white leading-tight mb-3">
          {t('landing.hero_title')}
        </h2>
        <p className="text-xl text-white/85 mb-10 max-w-sm">
          {t('landing.hero_sub')}
        </p>

        {/* Feature cards */}
        <div className="grid grid-cols-1 gap-4 w-full max-w-md mb-10">
          {features.map((f) => (
            <div key={f.titleKey} className={`flex items-center gap-4 p-4 rounded-2xl border-2 ${f.color} bg-opacity-90`}>
              <span className="text-4xl" role="img" aria-hidden="true">{f.icon}</span>
              <div className="text-left">
                <p className="font-bold text-gray-900 text-lg">{t(f.titleKey)}</p>
                <p className="text-gray-600 text-base">{t(f.descKey)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Main CTA */}
        <button
          className="btn-primary max-w-md shadow-lg shadow-primary-dark/30"
          onClick={() => router.push('/onboarding')}
        >
          <span className="text-2xl" role="img" aria-hidden="true">✅</span>
          {t('landing.cta')}
        </button>

        <p className="mt-5 text-white/60 text-sm">
          Free • No registration required • Works offline
        </p>
      </section>

      {/* Footer */}
      <footer className="text-center text-white/50 text-sm pb-8 px-5">
        <p>ArthSathi v1.0 · Made for rural India · MIT License</p>
      </footer>
    </main>
  );
}
