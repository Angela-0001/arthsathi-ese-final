/**
 * ArthSathi — Authentication Page (Redesigned)
 *
 * Clean login/signup with phone or email
 * Preserves exact API contract: POST /api/users
 * Stores user.id in 'as_user_id' localStorage
 * Redirects to /dashboard after success
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface StoredUser {
  id: string;
  phone_number: string | null;
  email: string | null;
  full_name: string | null;
  preferred_language: string;
  interaction_mode: string;
}

export default function AuthPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('register');

  // Shared fields
  const [phone, setPhone] = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  // State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function resetForm() {
    setError('');
    setPhone('');
    setEmail('');
    setName('');
    setUseEmail(false);
  }

  function switchTab(tab: 'login' | 'register') {
    setActiveTab(tab);
    resetForm();
  }

  async function handleSubmit() {
    setError('');
    const identifier = useEmail ? email.trim() : phone.trim();
    
    if (!identifier) {
      setError(useEmail ? 'Please enter your email address.' : 'Please enter your phone number.');
      return;
    }

    if (activeTab === 'register' && !name.trim()) {
      setError('Please enter your name.');
      return;
    }

    setLoading(true);
    try {
      const body: Record<string, string | null> = {
        preferred_language: 'hi',
        interaction_mode: 'text',
        full_name: name.trim() || null,
        state: null,
        district: null,
      };

      if (useEmail) {
        body.email = identifier;
        body.phone_number = null;
      } else {
        body.phone_number = identifier;
        body.email = null;
      }

      const res = await fetch(`${API}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const responseData = await res.json();

      if (!res.ok) {
        const errMsg = responseData?.error?.message || responseData?.message || responseData?.error || 
                      (activeTab === 'login' ? 'Login failed. Please try again.' : 'Registration failed. Please try again.');
        setError(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
        return;
      }

      const user: StoredUser = responseData.data;
      
      // Store user.id in 'as_user_id' (consistent key)
      localStorage.setItem('as_user_id', user.id);
      
      // Also store full user object for backward compatibility
      localStorage.setItem('arthsathi_user', JSON.stringify(user));
      
      // Redirect to dashboard
      router.push('/dashboard');
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-primary via-primary to-secondary flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        {/* Logo / branding */}
        <div className="text-center mb-8">
          <div className="text-7xl mb-4" role="img" aria-label="ArthSathi logo">🌱</div>
          <h1 className="text-4xl font-bold text-white mb-2">ArthSathi</h1>
          <p className="text-white/80 text-lg">{activeTab === 'login' ? 'Welcome Back' : 'Get Started for Free'}</p>
        </div>

        {/* Card */}
        <Card shadow="lg" padding="sm" className="overflow-hidden">
          {/* Tabs */}
          <div className="flex -m-1 mb-6">
            <button
              onClick={() => switchTab('register')}
              className={`flex-1 py-4 text-lg font-bold transition-all rounded-xl ${
                activeTab === 'register'
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-transparent text-gray-500 hover:bg-gray-50'
              }`}
            >
              Sign Up
            </button>
            <button
              onClick={() => switchTab('login')}
              className={`flex-1 py-4 text-lg font-bold transition-all rounded-xl ${
                activeTab === 'login'
                  ? 'bg-primary text-white shadow-md'
                  : 'bg-transparent text-gray-500 hover:bg-gray-50'
              }`}
            >
              Login
            </button>
          </div>

          {/* Form body */}
          <div className="px-2 space-y-5">
            {/* Name field (register only) */}
            {activeTab === 'register' && (
              <div>
                <label className="block text-base font-semibold text-gray-700 mb-2">
                  Your Name
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter your full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </div>
            )}

            {/* Phone / Email input */}
            {!useEmail ? (
              <div>
                <label className="block text-base font-semibold text-gray-700 mb-2">
                  Phone Number
                </label>
                <input
                  type="tel"
                  className="form-input"
                  placeholder="9876543210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="numeric"
                  autoComplete="tel"
                />
                <button
                  type="button"
                  onClick={() => { setUseEmail(true); setPhone(''); }}
                  className="mt-2 text-primary text-base font-medium underline"
                >
                  or use email instead
                </button>
              </div>
            ) : (
              <div>
                <label className="block text-base font-semibold text-gray-700 mb-2">
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
                  className="mt-2 text-primary text-base font-medium underline"
                >
                  or use phone number instead
                </button>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div role="alert" className="bg-red-50 border-2 border-red-200 rounded-2xl px-4 py-3">
                <p className="text-red-700 text-base font-medium">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <Button
              variant="primary"
              size="lg"
              loading={loading}
              onClick={handleSubmit}
            >
              {activeTab === 'login' ? 'Login' : 'Create Account'}
            </Button>

            {activeTab === 'register' && (
              <p className="text-center text-gray-500 text-sm">
                By signing up, you agree to use ArthSathi for free information. We never share your data.
              </p>
            )}
          </div>
        </Card>

        <p className="text-center text-white/70 text-base mt-6">
          Free • Quick registration • Works offline
        </p>
      </div>
    </main>
  );
}
