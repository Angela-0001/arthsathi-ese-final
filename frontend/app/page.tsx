'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, initLanguage, setLanguage, LANGUAGES, type LanguageCode } from '@/i18n';
import { useNavigate } from '@/hooks/useNavigate';

// ── How-to-use content ────────────────────────────────────────────────────────
const HOW_TO: Record<string, { title: string; voice: string; steps: { icon: string; h: string; d: string }[] }> = {
  hi: {
    title: 'ArthSathi कैसे इस्तेमाल करें?',
    voice: 'ArthSathi इस्तेमाल करना बहुत आसान है। पहले अपनी भाषा चुनें। फिर मोबाइल नंबर डालकर लॉगिन करें। अपनी जानकारी भरें जैसे उम्र, जाति, काम और आमदनी। फिर आपके लिए सरकारी योजनाएं और बीमा दिखाई देंगे। कोई भी कागज की फोटो खींचकर जोखिम जांच सकते हैं। और अपना वित्तीय रोडमैप भी देख सकते हैं।',
    steps: [
      { icon: '🌐', h: 'भाषा चुनें', d: 'हिंदी, मराठी या अंग्रेजी में से अपनी भाषा चुनें' },
      { icon: '📱', h: 'लॉगिन करें', d: 'अपना मोबाइल नंबर डालें और लॉगिन करें' },
      { icon: '📝', h: 'जानकारी भरें', d: 'उम्र, लिंग, जाति, काम और आमदनी बताएं' },
      { icon: '🌾', h: 'योजनाएं देखें', d: 'आपके लिए सरकारी योजनाएं और बीमा दिखेंगे' },
      { icon: '🔊', h: 'सुनें', d: 'हर योजना पर 🔊 दबाएं — हम बोलकर बताएंगे' },
      { icon: '📄', h: 'दस्तावेज जांचें', d: 'कागज की फोटो खींचें — जोखिम पता करें' },
    ],
  },
  mr: {
    title: 'ArthSathi कसे वापरायचे?',
    voice: 'ArthSathi वापरणे खूप सोपे आहे. प्रथम तुमची भाषा निवडा. मग मोबाइल नंबर टाकून लॉगिन करा. तुमची माहिती भरा. मग तुमच्यासाठी सरकारी योजना आणि विमा दाखवले जातील. कोणत्याही कागदाचा फोटो काढून जोखीम तपासू शकता.',
    steps: [
      { icon: '🌐', h: 'भाषा निवडा', d: 'हिंदी, मराठी किंवा इंग्रजी निवडा' },
      { icon: '📱', h: 'लॉगिन करा', d: 'मोबाइल नंबर टाका आणि लॉगिन करा' },
      { icon: '📝', h: 'माहिती भरा', d: 'वय, लिंग, जात, काम आणि उत्पन्न सांगा' },
      { icon: '🌾', h: 'योजना पाहा', d: 'तुमच्यासाठी सरकारी योजना आणि विमा दाखवले जातील' },
      { icon: '🔊', h: 'ऐका', d: 'प्रत्येक योजनेवर 🔊 दाबा — आम्ही सांगू' },
      { icon: '📄', h: 'कागद तपासा', d: 'कागदाचा फोटो काढा — जोखीम कळेल' },
    ],
  },
  en: {
    title: 'How to use ArthSathi?',
    voice: 'Using ArthSathi is very simple. First choose your language. Then login with your mobile number. Fill in your details like age, caste, occupation and income. Then government schemes and insurance for you will be shown. You can take a photo of any document to check for risks.',
    steps: [
      { icon: '🌐', h: 'Choose Language', d: 'Select Hindi, Marathi, or English' },
      { icon: '📱', h: 'Login', d: 'Enter your mobile number and login' },
      { icon: '📝', h: 'Fill Profile', d: 'Enter age, gender, caste, occupation and income' },
      { icon: '🌾', h: 'View Schemes', d: 'Government schemes and insurance matched to your profile' },
      { icon: '🔊', h: 'Listen', d: 'Tap 🔊 on any scheme to hear it read aloud' },
      { icon: '📄', h: 'Check Documents', d: 'Upload a photo of any document to detect risks' },
    ],
  },
};

function HowToUse({ lang }: { lang: string }) {
  const [speaking, setSpeaking] = useState(false);
  const content = HOW_TO[lang] || HOW_TO.hi;

  function speakGuide() {
    if (!('speechSynthesis' in window)) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(content.voice);
    const locales: Record<string, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
    utter.lang = locales[lang] || 'hi-IN';
    utter.rate = 0.85;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  return (
    <section className="py-14 px-5 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">{content.title}</h2>
          <button
            onClick={speakGuide}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm transition-all ${speaking ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
          >
            {speaking ? '⏹ Stop' : '🔊 Listen'}
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {content.steps.map((step, i) => (
            <div key={i} className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <div className="text-3xl mb-2">{step.icon}</div>
              <h3 className="font-bold text-gray-900 text-sm mb-1">{step.h}</h3>
              <p className="text-gray-500 text-xs leading-relaxed">{step.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Homepage() {
  const router = useRouter();
  const { navigate, navigating } = useNavigate();
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
            onClick={() => navigate('/auth')}
            disabled={navigating}
            className="bg-white text-primary font-bold text-lg px-8 py-4 rounded-2xl shadow-xl hover:bg-white/90 transition-all active:scale-95 flex items-center gap-3 mx-auto"
          >
            {navigating ? <span className="spinner spinner-green" /> : null}
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

      {/* How to Use Guide */}
      <HowToUse lang={lang} />

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
