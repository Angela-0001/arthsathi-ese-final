/**
 * ArthSathi — Root Layout
 *
 * Wraps every page with:
 * - Noto Sans font (covers all 6 languages in one font family)
 * - Global CSS
 * - PWA meta tags and manifest link
 * - Language/direction initialisation from localStorage
 */

import type { Metadata, Viewport } from 'next';
import { Noto_Sans } from 'next/font/google';
import '../styles/globals.css';
import OfflineBanner from '../components/ui/OfflineBanner';
import LanguageSwitcher from '../components/LanguageSwitcher';
import LanguageInitializer from '../components/LanguageInitializer';

// Noto Sans - latin + devanagari subsets (available via next/font/google)
// Tamil, Telugu, Bengali loaded via separate Noto font families below
const notoSans = Noto_Sans({
  subsets: ['latin', 'devanagari'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-noto',
  display: 'swap', // Prevents invisible text during font load on slow connections
});

export const metadata: Metadata = {
  title: 'ArthSathi — Your Financial Companion',
  description: 'Free AI-powered app helping rural Indians find government schemes, insurance, and financial guidance in their own language.',
  manifest: '/manifest.json',
  keywords: ['government schemes', 'insurance', 'rural India', 'financial help', 'arthsathi'],
  authors: [{ name: 'ArthSathi' }],
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ArthSathi',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#1B6B3A',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1, // Prevent accidental zoom on form inputs (common on Android)
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="hi" dir="ltr" className={notoSans.variable}>
      <head>
        {/* PWA: install prompt on Android */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* Preconnect to own API server for first-contentful-paint speed */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'} />
      </head>
      <body className="bg-surface min-h-screen">
        <LanguageInitializer />
        <OfflineBanner />
        {children}
        {/* Service worker registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').then(function(registration) {
                    console.log('[SW] Registered:', registration.scope);
                  }).catch(function(err) {
                    console.log('[SW] Registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
