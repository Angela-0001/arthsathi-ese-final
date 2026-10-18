/**
 * ArthSathi — Mobile Navigation Component
 *
 * Hamburger menu + bottom tab bar for mobile devices
 */

'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { t } from '@/i18n';

export default function MobileNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUserId(localStorage.getItem('as_user_id'));
    }
  }, []);

  useEffect(() => {
    // Close menu on route change
    setIsOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('as_user_id');
      localStorage.removeItem('as_profile');
      window.location.href = '/';
    }
  };

  const isActive = (path: string) => pathname === path;

  const navLinks = [
    { href: '/', label: t('nav.home'), icon: '🏠', key: 'home' },
    { href: '/onboarding', label: t('nav.eligibility'), icon: '✅', key: 'eligibility' },
    { href: '/document', label: t('nav.documents'), icon: '📄', key: 'documents' },
    { href: '/channels', label: t('nav.connect'), icon: '💬', key: 'connect' },
  ];

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden sticky top-0 z-50 bg-primary text-white shadow-lg">
        <div className="flex items-center justify-between px-4 h-16">
          {/* Hamburger Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Toggle menu"
            aria-expanded={isOpen}
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <span className="text-2xl" role="img" aria-label="Plant">🌱</span>
            <span className="text-xl font-bold">ArthSathi</span>
          </Link>

          {/* Language Switcher */}
          <div className="scale-90">
            <LanguageSwitcher />
          </div>
        </div>
      </div>

      {/* Slide-in Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Menu Panel */}
          <div className="fixed top-0 left-0 bottom-0 w-80 max-w-[85vw] bg-white z-50 shadow-2xl transform transition-transform duration-300 md:hidden overflow-y-auto">
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-2">
                  <span className="text-3xl" role="img" aria-label="Plant">🌱</span>
                  <span className="text-2xl font-bold text-primary">ArthSathi</span>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-lg hover:bg-gray-100"
                  aria-label="Close menu"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Navigation Links */}
              <nav className="space-y-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.key}
                    href={link.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-lg font-medium transition-colors ${
                      isActive(link.href)
                        ? 'bg-primary text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="text-2xl">{link.icon}</span>
                    <span>{link.label}</span>
                  </Link>
                ))}

                {/* IVR Call */}
                <a
                  href={`tel:${process.env.NEXT_PUBLIC_IVR_NUMBER || '+911234567890'}`}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-lg font-medium text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  <span className="text-2xl">📞</span>
                  <span>{t('nav.callUs')}</span>
                </a>
              </nav>

              {/* Divider */}
              <div className="my-6 border-t border-gray-200" />

              {/* Auth Section */}
              {userId ? (
                <div className="space-y-2">
                  <Link
                    href="/results"
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-lg font-medium text-gray-700 hover:bg-gray-100"
                  >
                    <span className="text-2xl">🎯</span>
                    <span>{t('nav.mySchemes')}</span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-lg font-medium text-red-600 hover:bg-red-50"
                  >
                    <span className="text-2xl">🚪</span>
                    <span>{t('nav.logout')}</span>
                  </button>
                </div>
              ) : (
                <Link
                  href="/auth"
                  className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-primary text-white rounded-xl text-lg font-semibold hover:bg-primary-dark transition-colors"
                >
                  <span className="text-2xl">🔐</span>
                  <span>{t('nav.login')}</span>
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      {/* Bottom Tab Bar */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40 safe-padding">
        <div className="flex items-center justify-around px-2 py-2">
          {navLinks.slice(0, 4).map((link) => (
            <Link
              key={link.key}
              href={link.href}
              className={`flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-xl transition-colors ${
                isActive(link.href)
                  ? 'text-primary bg-primary/10'
                  : 'text-gray-600 hover:text-primary'
              }`}
            >
              <span className="text-2xl mb-1">{link.icon}</span>
              <span className="text-xs font-medium">{link.label}</span>
            </Link>
          ))}
          
          {/* Profile/Login */}
          {userId ? (
            <Link
              href="/results"
              className={`flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-xl transition-colors ${
                isActive('/results')
                  ? 'text-primary bg-primary/10'
                  : 'text-gray-600 hover:text-primary'
              }`}
            >
              <span className="text-2xl mb-1">👤</span>
              <span className="text-xs font-medium">{t('nav.profile')}</span>
            </Link>
          ) : (
            <Link
              href="/auth"
              className={`flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-xl transition-colors ${
                isActive('/auth')
                  ? 'text-primary bg-primary/10'
                  : 'text-gray-600 hover:text-primary'
              }`}
            >
              <span className="text-2xl mb-1">🔐</span>
              <span className="text-xs font-medium">{t('nav.login')}</span>
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
