/**
 * ArthSathi — Dashboard Page (NEW)
 *
 * Protected route showing main action cards
 * Redirects to /auth if no as_user_id in localStorage
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { t } from '@/i18n';

export default function DashboardPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [userName, setUserName] = useState('');
  const [showIVRModal, setShowIVRModal] = useState(false);

  useEffect(() => {
    // Guard: redirect to auth if not logged in
    const userId = localStorage.getItem('as_user_id');
    if (!userId) {
      router.push('/auth');
      return;
    }

    // Get user name from profile if available
    try {
      const profileStr = localStorage.getItem('as_profile');
      if (profileStr) {
        const profile = JSON.parse(profileStr);
        setUserName(profile.full_name || '');
      } else {
        // Fallback: try arthsathi_user
        const userStr = localStorage.getItem('arthsathi_user');
        if (userStr) {
          const user = JSON.parse(userStr);
          setUserName(user.full_name || '');
        }
      }
    } catch {}

    setMounted(true);
  }, [router]);

  if (!mounted) return null;

  const IVR_NUMBER = process.env.NEXT_PUBLIC_IVR_NUMBER || '02248963501';
  const WHATSAPP = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || '+14155238886';
  const TELEGRAM = process.env.NEXT_PUBLIC_TELEGRAM_USERNAME || 'arthsathi_demo_bot';

  const actionCards = [
    {
      icon: '🎯',
      title: 'Check My Eligibility',
      desc: 'Answer questions to find schemes you qualify for',
      href: '/onboarding',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-200',
    },
    {
      icon: '🌾',
      title: 'My Recommended Schemes',
      desc: 'View schemes matched to your profile',
      href: '/results',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
    },
    {
      icon: '📄',
      title: 'Document Checker',
      desc: 'Understand any agreement before you sign',
      href: '/document',
      bgColor: 'bg-amber-50',
      borderColor: 'border-amber-200',
    },
    {
      icon: '💬',
      title: 'Connect on WhatsApp',
      desc: 'Chat with us anytime for help',
      href: `https://wa.me/${WHATSAPP.replace(/[^0-9]/g, '')}`,
      external: true,
      bgColor: 'bg-green-50',
      borderColor: 'border-green-300',
    },
    {
      icon: '📱',
      title: 'Connect on Telegram',
      desc: 'Message our bot for quick answers',
      href: `https://t.me/${TELEGRAM}`,
      external: true,
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-300',
    },
    {
      icon: '📞',
      title: 'Call Us (IVR)',
      desc: 'Get scheme info by phone in your language',
      onClick: () => setShowIVRModal(true),
      bgColor: 'bg-orange-50',
      borderColor: 'border-orange-200',
    },
  ];

  return (
    <main className="min-h-screen bg-surface py-8 px-5">
      <div className="max-w-6xl mx-auto">
        {/* Welcome Header */}
        <div className="mb-12 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-3">
            {userName ? `Welcome, ${userName}!` : 'Welcome to ArthSathi!'}
          </h1>
          <p className="text-xl text-gray-600">
            Choose what you'd like to do today
          </p>
        </div>

        {/* Action Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {actionCards.map((card, i) => (
            <Card
              key={i}
              padding="lg"
              hoverable
              className={`${card.bgColor} border-2 ${card.borderColor} flex flex-col`}
              onClick={card.onClick}
              style={{ cursor: card.onClick ? 'pointer' : 'default' }}
            >
              <div className="text-6xl mb-4 text-center">{card.icon}</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">{card.title}</h2>
              <p className="text-base text-gray-600 mb-4 text-center flex-1">{card.desc}</p>
              
              {card.href && (
                card.external ? (
                  <a
                    href={card.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block w-full"
                  >
                    <Button variant="primary" size="md" fullWidth>
                      Open
                    </Button>
                  </a>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    fullWidth
                    onClick={() => router.push(card.href!)}
                  >
                    Go
                  </Button>
                )
              )}
              
              {card.onClick && !card.href && (
                <Button variant="primary" size="md" fullWidth>
                  View
                </Button>
              )}
            </Card>
          ))}
        </div>

        {/* Quick Info Section */}
        <div className="mt-16 text-center">
          <Card padding="lg" className="bg-white border-2 border-primary/20">
            <h3 className="text-2xl font-bold text-gray-900 mb-3">Need Help?</h3>
            <p className="text-base text-gray-600 mb-6">
              ArthSathi is free and available 24/7. Choose your preferred way to connect with us.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <a
                href={`tel:${IVR_NUMBER}`}
                className="px-6 py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary-dark transition-colors"
              >
                📞 Call {IVR_NUMBER}
              </a>
              <a
                href={`https://wa.me/${WHATSAPP.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors"
              >
                💬 WhatsApp
              </a>
              <a
                href={`https://t.me/${TELEGRAM}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-6 py-3 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600 transition-colors"
              >
                📱 Telegram
              </a>
            </div>
          </Card>
        </div>
      </div>

      {/* IVR Modal */}
      <Modal
        isOpen={showIVRModal}
        onClose={() => setShowIVRModal(false)}
        title="Call ArthSathi IVR"
        size="md"
      >
        <div className="text-center">
          <div className="text-6xl mb-4">📞</div>
          <p className="text-xl font-bold text-gray-900 mb-2">Call: {IVR_NUMBER}</p>
          <p className="text-base text-gray-600 mb-6">
            Our IVR system is available 24/7 in 6 languages. Call and follow these steps:
          </p>
          <ol className="text-left text-base text-gray-700 space-y-2 mb-6 max-w-md mx-auto">
            <li>1. Choose your language (1-6)</li>
            <li>2. Answer questions using your phone keypad</li>
            <li>3. Listen to scheme recommendations</li>
            <li>4. Get details via SMS</li>
          </ol>
          <a
            href={`tel:${IVR_NUMBER}`}
            className="inline-block px-8 py-4 bg-primary text-white rounded-xl font-bold text-lg hover:bg-primary-dark transition-colors"
          >
            Call Now
          </a>
        </div>
      </Modal>
    </main>
  );
}
