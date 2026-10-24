'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, initLanguage, setLanguage, LANGUAGES, type LanguageCode } from '@/i18n';

export default function Homepage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [lang, setLang] = useState<LanguageCode>('hi');

  useEffect(() => {
    initLanguage();
    const saved = localStorage.getItem('arthsathi_lang') as LanguageCode | null;
    if (saved && saved in LANGUAGES) setLang(saved);
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const IVR_NUMBER = process.env.NEXT_PUBLIC_IVR_NUMBER || '02248963501';
  const WHATSAPP   = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '14155238886';
  const TELEGRAM   = process.env.NEXT_PUBLIC_TELEGRAM_USERNAME || 'arthsathi_demo_bot';

  function handleLang(code: LanguageCode) {
    setLang(code);
    setLanguage(code);
    // Re-render by updating state — no full reload needed on homepage
  }

  return (
    <main className="min-h-screen bg-gray-50">

      {/* Language selector strip */}
      <div className="bg-white border-b border-gray-100 py-2 px-5 flex justify-center gap-3">
        {(Object.keys(LANGUAGES) as LanguageCode[]).map(code => (
          <button
            key={code}
            onClick={() => handleLang(code)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              lang === code
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {LANGUAGES[code].nativeName}
          </button>
        ))}
      </div>

      {/* Hero */}
      <section className="bg-gradient-to-br from-primary via-primary to-secondary text-white py-20 px-5">
        <div className="max-w-2xl mx-auto text-center">
          <div className="text-7xl mb-5">🌱</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4">{t('home.hero_title')}</h1>
          <p className="text-xl text-white/90 mb-3 max-w-xl mx-auto">{t('home.hero_sub')}</p>
          <p className="text-white/70 text-sm mb-8">{t('home.hero_sub2')}</p>
          <button
            onClick={() => router.push('/auth')}
            className="bg-white text-primary font-bold text-lg px-8 py-4 rounded-2xl shadow-xl hover:bg-white/90 transition-colors"
          >
            {t('home.get_started')}
          </button>
        </div>
      </section>

      {/* Features */}
      <section className="py-14 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">{t('home.features_title')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="border-2 border-green-200 rounded-2xl p-6 bg-green-50">
              <div className="text-4xl mb-3">🌾</div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">{t('home.feat1_title')}</h3>
              <p className="text-gray-600 text-sm">{t('home.feat1_desc')}</p>
            </div>
            <div className="border-2 border-blue-200 rounded-2xl p-6 bg-blue-50">
              <div className="text-4xl mb-3">🛡️</div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">{t('home.feat2_title')}</h3>
              <p className="text-gray-600 text-sm">{t('home.feat2_desc')}</p>
            </div>
            <div className="border-2 border-amber-200 rounded-2xl p-6 bg-amber-50">
              <div className="text-4xl mb-3">📄</div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">{t('home.feat3_title')}</h3>
              <p className="text-gray-600 text-sm">{t('home.feat3_desc')}</p>
            </div>
            <div className="border-2 border-red-200 rounded-2xl p-6 bg-red-50">
              <div className="text-4xl mb-3">⚠️</div>
              <h3 className="font-bold text-gray-900 text-lg mb-2">{t('home.feat4_title')}</h3>
              <p className="text-gray-600 text-sm">{t('home.feat4_desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Connect */}
      <section className="py-14 px-5 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">📲 {t('home.connect_title')}</h2>
          <p className="text-center text-gray-500 text-sm mb-10">{t('home.connect_sub')}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div className="border-2 border-primary/20 rounded-2xl p-5 text-center bg-white">
              <div className="text-4xl mb-2">📞</div>
              <h3 className="font-bold text-gray-900 mb-1">{t('home.call')}</h3>
              <p className="text-gray-500 text-xs mb-3">{t('home.call_sub')}</p>
              <a href={`tel:${IVR_NUMBER}`}
                className="inline-block px-4 py-2 bg-primary text-white rounded-xl font-semibold text-sm">
                {IVR_NUMBER}
              </a>
            </div>
            <div className="border-2 border-green-200 rounded-2xl p-5 text-center bg-white">
              <div className="text-4xl mb-2">💬</div>
              <h3 className="font-bold text-gray-900 mb-1">{t('home.whatsapp')}</h3>
              <p className="text-gray-500 text-xs mb-3">{t('home.whatsapp_sub')}</p>
              <a href={`https://wa.me/${WHATSAPP.replace(/[^0-9]/g, '')}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-green-500 text-white rounded-xl font-semibold text-sm">
                WhatsApp
              </a>
            </div>
            <div className="border-2 border-blue-200 rounded-2xl p-5 text-center bg-white">
              <div className="text-4xl mb-2">📱</div>
              <h3 className="font-bold text-gray-900 mb-1">{t('home.telegram')}</h3>
              <p className="text-gray-500 text-xs mb-3">{t('home.telegram_sub')}</p>
              <a href={`https://t.me/${TELEGRAM}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-blue-500 text-white rounded-xl font-semibold text-sm">
                Telegram
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-5 bg-gray-900 text-white text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <span className="text-2xl">🌱</span>
          <span className="text-xl font-bold">ArthSathi</span>
        </div>
        <p className="text-gray-400 text-sm mb-3">{t('app.tagline')}</p>
        <div className="flex flex-wrap justify-center gap-5 text-xs text-gray-500 mb-3">
          <a href={`tel:${IVR_NUMBER}`} className="hover:text-white">📞 {IVR_NUMBER}</a>
          <a href={`https://wa.me/${WHATSAPP.replace(/[^0-9]/g, '')}`}
            target="_blank" rel="noopener noreferrer" className="hover:text-white">💬 WhatsApp</a>
          <a href={`https://t.me/${TELEGRAM}`}
            target="_blank" rel="noopener noreferrer" className="hover:text-white">📱 Telegram</a>
        </div>
        <p className="text-gray-600 text-xs">{t('home.disclaimer') || 'ArthSathi provides information only. Eligibility subject to government rules.'}</p>
      </footer>
    </main>
  );
}
