/**
 * ArthSathi — Channels Page
 *
 * Shows IVR, WhatsApp, and Telegram connection options with usage instructions.
 */

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { t, initLanguage } from '@/i18n';

interface Channel {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  howToUse: string;
  action: React.ReactNode;
}

export default function ChannelsPage() {
  const [copiedIVR, setCopiedIVR] = useState(false);
  useEffect(() => { initLanguage(); }, []);

  function handleCopyIVR() {
    navigator.clipboard.writeText('02248963501').then(() => {
      setCopiedIVR(true);
      setTimeout(() => setCopiedIVR(false), 2000);
    });
  }

  const channels: Channel[] = [
    {
      id: 'ivr',
      icon: '📞',
      title: 'IVR (Phone Call)',
      subtitle: 'Call: 02248963501',
      description: 'Call and get scheme info in Hindi, Marathi or English',
      color: 'bg-orange-50 border-orange-200',
      howToUse: 'Dial 02248963501. Choose your language. Ask about schemes or insurance by speaking naturally.',
      action: (
        <button
          onClick={handleCopyIVR}
          className="mt-3 px-4 py-2 text-sm rounded-xl bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
        >
          {copiedIVR ? '✅ Copied!' : 'Copy Number'}
        </button>
      ),
    },
    {
      id: 'whatsapp',
      icon: '💬',
      title: 'WhatsApp',
      subtitle: 'Number: +14155238886',
      description: 'Chat on WhatsApp for scheme recommendations',
      color: 'bg-green-50 border-green-200',
      howToUse: "Save +14155238886 as ArthSathi. Send 'Hi' to start. Ask questions in Hindi, English, or Marathi.",
      action: (
        <a
          href="https://wa.me/14155238886"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 px-4 py-2 text-sm rounded-xl bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
        >
          Open WhatsApp
        </a>
      ),
    },
    {
      id: 'telegram',
      icon: '📱',
      title: 'Telegram',
      subtitle: 'Bot: @arthsathi_demo_bot',
      description: 'Chat on Telegram for scheme info',
      color: 'bg-blue-50 border-blue-200',
      howToUse: 'Search @arthsathi_demo_bot on Telegram. Press Start. Type 1 for schemes, 2 for insurance.',
      action: (
        <a
          href="https://t.me/arthsathi_demo_bot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-3 px-4 py-2 text-sm rounded-xl bg-primary text-white font-semibold hover:bg-primary-dark transition-colors"
        >
          Open Telegram
        </a>
      ),
    },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary-600 to-primary-500 flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 pt-10 pb-4">
        <Link
          href="/"
          className="flex items-center gap-2 text-white/80 hover:text-white transition-colors text-base font-medium"
          aria-label="Back to home"
        >
          ← Back
        </Link>
        <div className="text-white">
          <h1 className="text-2xl font-bold">{t('connect.title') || 'Connect With ArthSathi'}</h1>
          <p className="text-white/80 text-sm">{t('connect.subtitle') || 'Choose your preferred channel'}</p>
        </div>
      </header>

      {/* Channels */}
      <section className="flex-1 flex flex-col items-center px-5 py-8 gap-6">
        {channels.map((ch) => (
          <div
            key={ch.id}
            className={`w-full max-w-lg rounded-2xl border-2 ${ch.color} p-5 shadow-sm`}
          >
            {/* Card header */}
            <div className="flex items-center gap-4 mb-3">
              <span className="text-5xl" role="img" aria-hidden="true">{ch.icon}</span>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{ch.title}</h2>
                <p className="text-gray-500 text-sm font-medium">{ch.subtitle}</p>
              </div>
            </div>

            {/* Description */}
            <p className="text-gray-700 text-base mb-1">{ch.description}</p>

            {/* How to use */}
            <div className="mt-3 bg-white/60 rounded-xl p-3 border border-white/50">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">How to use</p>
              <p className="text-gray-800 text-sm leading-relaxed">{ch.howToUse}</p>
            </div>

            {/* Action button */}
            {ch.action}
          </div>
        ))}
      </section>

      {/* Footer */}
      <footer className="text-center text-white/50 text-sm pb-8 px-5">
        <p>ArthSathi v1.0 · Made for rural India · MIT License</p>
      </footer>
    </main>
  );
}
