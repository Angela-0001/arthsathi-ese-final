/**
 * ArthSathi — Desktop Navbar Component
 *
 * Sticky top navigation with logo, links, language switcher, auth/profile
 */

'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { t } from '@/i18n';

export default function Navbar() {
  const pathname = usePathname();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setUserId(localStorage.getItem('as_user_id'));
    }
  }, []);

  const isActive = (path: string) => pathname === path;

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('as_user_id');
      localStorage.removeItem('as_profile');
      window.location.href = '/';
    }
  };

  const navLinks = [
    { href: '/', label: t('nav.home'), key: 'home' },
    { href: '/onboarding', label: t('nav.eligibility'), key: 'eligibility' },
    { href: '/document', label: t('nav.documents'), key: 'documents' },
    { href: '/channels', label: t('nav.connect'), key: 'connect' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-primary text-white shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-3xl" role="img" aria-label="Plant">🌱</span>
            <span className="text-2xl font-bold">ArthSathi</span>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.key}
                href={link.href}
                className={`px-3 py-2 rounded-lg font-medium transition-colors ${
                  isActive(link.href)
                    ? 'bg-white/20 text-white'
                    : 'text-white/90 hover:bg-white/10'
                }`}
              >
                {link.label}
              </Link>
            ))}

            {/* IVR Call Us Link */}
            <a
              href={`tel:${process.env.NEXT_PUBLIC_IVR_NUMBER || '+911234567890'}`}
              className="px-3 py-2 rounded-lg font-medium text-white/90 hover:bg-white/10 transition-colors flex items-center gap-2"
            >
              <span>📞</span>
              <span>{t('nav.callUs')}</span>
            </a>
          </div>

          {/* Right side: Language + Auth */}
          <div className="flex items-center gap-4">
            <LanguageSwitcher />

            {/* Auth/Profile */}
            {userId ? (
              <div className="relative group">
                <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                  <span className="text-xl">👤</span>
                  <span className="hidden sm:inline font-medium">{t('nav.profile')}</span>
                </button>
                
                {/* Dropdown menu */}
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                  <Link
                    href="/results"
                    className="block px-4 py-3 text-gray-700 hover:bg-gray-100 rounded-t-lg"
                  >
                    {t('nav.mySchemes')}
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-3 text-red-600 hover:bg-gray-100 rounded-b-lg"
                  >
                    {t('nav.logout')}
                  </button>
                </div>
              </div>
            ) : (
              <Link
                href="/auth"
                className="px-4 py-2 bg-white text-primary rounded-lg font-semibold hover:bg-white/90 transition-colors"
              >
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
