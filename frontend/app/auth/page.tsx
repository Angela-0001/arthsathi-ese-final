'use client';

import { useState, useEffect } from 'react';
import { getApiUrl } from '@/lib/config';
import { useRouter } from 'next/navigation';
import { t, initLanguage, setLanguage, LANGUAGES, type LanguageCode } from '@/i18n';

const API = getApiUrl();

export default function AuthPage() {
  const [mounted, setMounted] = useState(false);
  const [lang, setLang] = useState<LanguageCode>('hi');

  useEffect(() => {
    initLanguage();
    const saved = localStorage.getItem('arthsathi_lang') as LanguageCode | null;
    if (saved && saved in LANGUAGES) setLang(saved);
    setMounted(true);
  }, []);

  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [phone, setPhone]     = useState('');
  const [name, setName]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  function switchTab(tab: 'login' | 'register') {
    setActiveTab(tab);
    setError('');
    setPhone('');
    setName('');
  }

  function handleLang(code: LanguageCode) {
    setLang(code);
    setLanguage(code);
  }

  async function handleSubmit() {
    setError('');
    if (!phone.trim()) { setError(t('auth.phone') + ' required'); return; }
    if (activeTab === 'register' && !name.trim()) { setError(t('auth.your_name') + ' required'); return; }
    setLoading(true);
    try {
      if (activeTab === 'login') {
        // LOGIN: check if phone exists, don't create new user
        const checkRes = await fetch(`${API}/api/users?phone=${encodeURIComponent(phone.trim())}`);
        const checkData = await checkRes.json();
        if (!checkRes.ok || !checkData.data || checkData.data.length === 0) {
          setError(t('auth.phone_not_found') || 'Phone number not found. Please sign up first.');
          setLoading(false);
          return;
        }
        const user = checkData.data[0];
        localStorage.setItem('as_user_id', String(user.id));
        localStorage.setItem('arthsathi_user', JSON.stringify(user));
        // If profile is complete, go to results; otherwise onboarding
        const hasProfile = user.age && user.occupation;
        router.push(hasProfile ? '/results' : '/onboarding');
      } else {
        // REGISTER: create or return existing user
        const res = await fetch(`${API}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_number:       phone.trim(),
            full_name:          name.trim() || null,
            preferred_language: lang,
            interaction_mode:   'text',
            state:              null,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data?.error?.message || t('common.error')); return; }
        // If phone already exists, tell user to login instead
        if (res.status === 200) {
          setError(t('auth.already_exists') || 'Account already exists. Please use Login tab.');
          setLoading(false);
          return;
        }
        localStorage.setItem('as_user_id', String(data.data.id));
        localStorage.setItem('arthsathi_user', JSON.stringify(data.data));
        router.push('/onboarding');
      }
    } catch {
      setError(t('auth.network_error'));
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) return null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary via-primary to-secondary flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">

        {/* Language selector */}
        <div className="flex justify-center gap-2 mb-6">
          {(Object.keys(LANGUAGES) as LanguageCode[]).map(code => (
            <button
              key={code}
              onClick={() => handleLang(code)}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                lang === code
                  ? 'bg-white text-primary shadow'
                  : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {LANGUAGES[code].nativeName}
            </button>
          ))}
        </div>

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-7xl mb-4">🌱</div>
          <h1 className="text-4xl font-bold text-white mb-2">{t('app.name')}</h1>
          <p className="text-white/80 text-lg">
            {activeTab === 'login' ? t('auth.welcome_back') : t('auth.get_started')}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl p-6">
          {/* Tabs */}
          <div className="flex mb-6 bg-gray-100 rounded-2xl p-1">
            {(['register', 'login'] as const).map(tab => (
              <button
                suppressHydrationWarning
                key={tab}
                onClick={() => switchTab(tab)}
                className={`flex-1 py-3 text-base font-bold rounded-xl transition-all ${
                  activeTab === tab ? 'bg-white text-primary shadow' : 'text-gray-500'
                }`}
              >
                {tab === 'register' ? t('auth.sign_up') : t('auth.login')}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {/* Name (register only) */}
            {activeTab === 'register' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{t('auth.your_name')}</label>
                <input
                  suppressHydrationWarning
                  type="text"
                  className="form-input"
                  placeholder={t('auth.name_placeholder')}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}

            {/* Phone */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">{t('auth.phone')}</label>
              <input
                suppressHydrationWarning
                type="tel"
                className="form-input"
                placeholder={t('auth.phone_placeholder')}
                value={phone}
                onChange={e => setPhone(e.target.value)}
                inputMode="numeric"
                autoComplete="tel"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <p className="text-red-700 text-sm font-medium">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              suppressHydrationWarning
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-primary text-white font-bold text-lg py-4 rounded-2xl disabled:opacity-60"
            >
              {loading
                ? t('auth.wait')
                : activeTab === 'login' ? t('auth.login') : t('auth.create_account')}
            </button>

            {activeTab === 'register' && (
              <p className="text-center text-gray-400 text-xs">{t('auth.free_note')}</p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
