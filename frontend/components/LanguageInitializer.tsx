/**
 * ArthSathi — Language Initializer
 *
 * Client component that initializes language from localStorage on mount.
 * Runs once per session to set up HTML lang and dir attributes.
 */

'use client';

import { useEffect } from 'react';
import { initLanguage } from '@/i18n';

export default function LanguageInitializer() {
  useEffect(() => {
    initLanguage();
  }, []);

  return null;
}
