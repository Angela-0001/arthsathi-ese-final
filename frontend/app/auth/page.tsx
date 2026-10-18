'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface StoredUser {
  id: string;
  phone_number: string | null;
  full_name: string | null;
  preferred_language: string;
  interaction_mode: string;
}

export default function AuthPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');

  // Shared fields
  const [phone, setPhone] = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [email, setEmail] = useState('');

  // Login-only
  const [password, setPassword] = useState('');

  // Register-only
  const [name, setName] = useState('');

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [userId, setUserId] = useState('');

  function resetForm() {
    setError('');
    setPhone('');
    setEmail('');
    setPassword('');
    setName('');
    setUseEmail(false);
  }

  function switchTab(tab: 'login' | 'register') {
    setActiveTab(tab);
    resetForm();
  }

  async function handleRegister() {
    setError('');
    const identifier = useEmail ? email.trim() : phone.trim();
    if (!identifier) {
      setError(useEmail ? 'Please enter your email address.' : 'Please enter your phone number.');
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, string | null> = {
        preferred_language: 'hi',
        full_name: name.trim() || null,
      };
      if (useEmail) {
        body.email = identifier;
        body.phone_number = null;
      } else {
        body.phone_number = identifier;
      }

      const res = await fetch(`${API}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const responseData = await res.json();

      if (!res.ok) {
        const errMsg = responseData?.error?.message || responseData?.message || responseData?.error || 'Registration failed. Please try again.';
        setError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
        return;
      }

      const user: StoredUser = responseData.data;
      localStorage.setItem('arthsathi_user', JSON.stringify(user));
      setUserId(user.id);
      setShowConnect(true);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin() {
    setError('');
    const identifier = useEmail ? email.trim() : phone.trim();
    if (!identifier) {
      setError(useEmail ? 'Please enter your email address.' : 'Please enter your phone number.');
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, string | null> = {
        preferred_language: 'hi',
        full_name: null,
      };
      if (useEmail) {
        body.email = identifier;
        body.phone_number = null;
      } else {
        body.phone_number = identifier;
      }

      const res = await fetch(`${API}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const responseData = await res.json();

      if (!res.ok) {
        const errMsg = responseData?.error?.message || responseData?.message || responseData?.error || 'Login failed. Please try again.';
        setError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
        return;
      }

      const user: StoredUser = responseData.data;
      localStorage.setItem('arthsathi_user', JSON.stringify(user));
      router.push('/onboarding');
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit() {
    if (activeTab === 'register') {
      handleRegister();
    } else {
      handleLogin();
    }
  }

  // ── Connect screen shown after successful register ────────────────────
  if (showConnect) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-primary to-primary-light flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to ArthSathi!</h1>
          <p className="text-gray-600 text-base mb-8">
            Link your phone to get scheme info on WhatsApp and Telegram too.
          </p>

          <div className="space-y-4">
            <a
              href={`https://wa.me/14155238886?text=Hi+ArthSathi+my+id+is+${userId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full min-h-[48px] py-3 px-5 rounded-2xl bg-green-500 text-white font-bold text-lg hover:bg-green-600 transition-colors"
            >
              <span>💬</span> Connect on WhatsApp
            </a>

            <a
              href={`https://t.me/arthsathi_demo_bot?start=${userId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full min-h-[48px] py-3 px-5 rounded-2xl bg-blue-500 text-white font-bold text-lg hover:bg-blue-600 transition-colors"
            >
              <span>📱</span> Open Telegram Bot
            </a>

            <button
              onClick={() => router.push('/onboarding')}
              className="btn-primary"
            >
              Continue to App →
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Auth form ─────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gradient-to-b from-primary to-primary-light flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="text-6xl mb-3" role="img" aria-label="ArthSathi logo">🌱</div>
          <h1 className="text-3xl font-bold text-white">ArthSathi</h1>
          <p className="text-white/80 text-base mt-1">Your Financial Guide</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          {/* Tabs */}
          <div className="flex">
            <button
              onClick={() => switchTab('login')}
              className={`flex-1 py-4 text-lg font-bold transition-colors ${
                activeTab === 'login'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => switchTab('register')}
              className={`flex-1 py-4 text-lg font-bold transition-colors ${
                activeTab === 'register'
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Register
            </button>
          </div>

          {/* Form body */}
          <div className="p-6 space-y-4">
            {/* Register-only: name field */}
            {activeTab === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}

            {/* Phone / Email input */}
            {!useEmail ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="Phone number e.g. 9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="numeric"
                  autoComplete="tel"
                />
                <button
                  type="button"
                  onClick={() => { setUseEmail(true); setPhone(''); }}
                  className="mt-1 text-primary text-sm underline"
                >
                  or use email
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
                <button
                  type="button"
                  onClick={() => { setUseEmail(false); setEmail(''); }}
                  className="mt-1 text-primary text-sm underline"
                >
                  or use phone number
                </button>
              </div>
            )}

            {/* Login-only: password field */}
            {activeTab === 'login' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
            )}

            {/* Error message */}
            {error && (
              <p role="alert" className="text-red-600 text-sm font-medium bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="btn-primary"
            >
              {loading ? 'Loading...' : activeTab === 'login' ? 'Login' : 'Create Account'}
            </button>
          </div>
        </div>

        <p className="text-center text-white/60 text-sm mt-6">
          Free • Quick registration • Works offline
        </p>
      </div>
    </main>
  );
}
