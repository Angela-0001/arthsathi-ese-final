/**
 * ArthSathi — Homepage (Redesigned)
 *
 * Public landing page with hero, how-it-works, features, connect info, footer
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, initLanguage, currentLanguage, type LanguageCode } from '../i18n';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

export default function Homepage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    initLanguage();
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const IVR_NUMBER = process.env.NEXT_PUBLIC_IVR_NUMBER || '02248963501';
  const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '+14155238886';
  const TELEGRAM = process.env.NEXT_PUBLIC_TELEGRAM_USERNAME || 'arthsathi_demo_bot';

  return (
    <main className="min-h-screen bg-surface">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary via-primary to-secondary text-white py-16 px-5">
        <div className="max-w-4xl mx-auto text-center">
          <div className="text-7xl mb-6" role="img" aria-label="ArthSathi logo">🌱</div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
            {t('landing.hero_title')}
          </h1>
          <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-2xl mx-auto">
            {t('landing.hero_sub')}
          </p>
          <Button
            variant="accent"
            size="lg"
            icon="✅"
            onClick={() => router.push('/auth')}
            className="max-w-md mx-auto shadow-2xl"
          >
            {t('landing.cta')}
          </Button>
          <p className="mt-6 text-white/70 text-base">
            {t('common.free')} • Quick registration • Works offline
          </p>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 px-5 bg-white">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">
            How ArthSathi Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '1', icon: '📝', title: 'Answer Questions', desc: 'Tell us about yourself in your language — voice or text' },
              { step: '2', icon: '🎯', title: 'See Your Schemes', desc: 'Get instant recommendations matched to your profile' },
              { step: '3', icon: '✅', title: 'Apply & Get Help', desc: 'Apply directly or get help via WhatsApp, Telegram, or phone' },
            ].map((item) => (
              <Card key={item.step} padding="lg" hoverable className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary font-bold text-2xl mb-4">
                  {item.step}
                </div>
                <div className="text-5xl mb-4">{item.icon}</div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-gray-600 text-base">{item.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Highlights */}
      <section className="py-16 px-5 bg-surface">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">
            What You Can Do
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: '🌾', title: t('landing.feature_1_title'), desc: t('landing.feature_1_desc'), color: 'bg-green-50 border-green-200' },
              { icon: '🛡️', title: t('landing.feature_2_title'), desc: t('landing.feature_2_desc'), color: 'bg-blue-50 border-blue-200' },
              { icon: '📄', title: t('landing.feature_3_title'), desc: t('landing.feature_3_desc'), color: 'bg-amber-50 border-amber-200' },
              { icon: '🎤', title: 'Voice Support', desc: 'Answer questions by speaking — works in all 6 languages', color: 'bg-purple-50 border-purple-200' },
            ].map((feature, i) => (
              <Card key={i} padding="lg" hoverable className={`${feature.color} border-2`}>
                <div className="text-5xl mb-4 text-center">{feature.icon}</div>
                <h3 className="text-lg font-bold text-gray-900 mb-2 text-center">{feature.title}</h3>
                <p className="text-gray-600 text-base text-center">{feature.desc}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Connect With Us */}
      <section className="py-16 px-5 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-4">
            📲 Connect With ArthSathi
          </h2>
          <p className="text-center text-gray-600 text-lg mb-12 max-w-2xl mx-auto">
            Use the app, or get help through your preferred channel
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* IVR */}
            <Card padding="lg" hoverable className="text-center border-2 border-primary/20">
              <div className="text-6xl mb-4">📞</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Call Us (IVR)</h3>
              <p className="text-gray-600 text-base mb-4">Get scheme info by phone</p>
              <a
                href={`tel:${IVR_NUMBER}`}
                className="inline-block px-6 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-colors"
              >
                Call {IVR_NUMBER}
              </a>
            </Card>

            {/* WhatsApp */}
            <Card padding="lg" hoverable className="text-center border-2 border-green-200">
              <div className="text-6xl mb-4">💬</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">WhatsApp</h3>
              <p className="text-gray-600 text-base mb-4">Chat with us anytime</p>
              <a
                href={`https://wa.me/${WHATSAPP.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors"
              >
                Open WhatsApp
              </a>
            </Card>

            {/* Telegram */}
            <Card padding="lg" hoverable className="text-center border-2 border-blue-200">
              <div className="text-6xl mb-4">📱</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Telegram</h3>
              <p className="text-gray-600 text-base mb-4">Message our bot</p>
              <a
                href={`https://t.me/${TELEGRAM}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-6 py-3 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 transition-colors"
              >
                Open Telegram
              </a>
            </Card>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-5 bg-gray-900 text-white">
        <div className="max-w-6xl mx-auto text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-3xl" role="img" aria-label="Plant">🌱</span>
            <span className="text-2xl font-bold">ArthSathi</span>
          </div>
          <p className="text-gray-400 text-base mb-4">
            {t('app.tagline')} • Free, Multilingual, Always Available
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 mb-6 text-sm text-gray-400">
            <a href={`tel:${IVR_NUMBER}`} className="hover:text-white transition-colors">
              📞 IVR: {IVR_NUMBER}
            </a>
            <a href={`https://wa.me/${WHATSAPP.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              💬 WhatsApp
            </a>
            <a href={`https://t.me/${TELEGRAM}`} target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              📱 Telegram
            </a>
          </div>
          <p className="text-gray-500 text-sm">
            ArthSathi v1.0 · Made for rural India · MIT License
          </p>
          <p className="text-gray-600 text-xs mt-2">
            Disclaimer: ArthSathi provides information only. Eligibility and scheme details are subject to government rules. We do not guarantee approval.
          </p>
        </div>
      </footer>
    </main>
  );
}
