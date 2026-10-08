'use client';
/**
 * ArthSathi — Results Page (v2)
 *
 * OFFLINE BUG FIX:
 * - Does NOT use navigator.onLine alone (unreliable).
 * - Checks connectivity by attempting a lightweight GET to /api/health
 *   with a 5s timeout and up to 2 retries.
 * - On failure: loads from IndexedDB/localStorage cache with banner.
 * - Never shows a blocking "No internet" error screen.
 *
 * RESULTS:
 * - Shows up to 10 schemes + top 5 insurance from the Python engine.
 * - Each card shows: name, benefit, "why this fits you" from score breakdown,
 *   documents needed, Listen button, Save/Apply/Not for me.
 * - Interactions logged back to /api/schemes/event for adaptive learning.
 */

import { useEffect, useState, Suspense, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const CACHE_KEY = 'as_results_v2';

// ─── Types ─────────────────────────────────────────────────────────────────

interface SchemeResult {
  id: string;
  source_id: string;
  name: { en?: string; hi?: string; [k: string]: string | undefined };
  description?: { en?: string; [k: string]: string | undefined };
  benefits_text?: { en?: string; [k: string]: string | undefined };
  category: string;
  tags?: string[];
  benefit_type?: string;
  benefit_amount_min?: number;
  benefit_amount_max?: number;
  application_url?: string;
  ministry?: string;
  level?: string;
  score: number;
  score_breakdown?: Record<string, number>;
  eligibility_status?: 'eligible' | 'likely' | 'unknown';
  explain_text?: string;
  missing_criteria?: string[];
  _is_exploration?: boolean;
}

interface InsuranceResult {
  id: string;
  source_id: string;
  name: { en?: string; hi?: string; [k: string]: string | undefined };
  description?: { en?: string; [k: string]: string | undefined };
  annual_premium?: number;
  coverage_amount?: number;
  coverage_type?: string;
  application_url?: string;
  score: number;
  score_breakdown?: Record<string, number>;
  eligibility_status?: string;
  explain_text?: string;
}

// ─── Connectivity check ───────────────────────────────────────────────────

async function checkConnectivity(retries = 2): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const ctrl = new AbortController();
      const tid   = setTimeout(() => ctrl.abort(), 5000);
      const r     = await fetch(`${API}/api/health`, { signal: ctrl.signal });
      clearTimeout(tid);
      if (r.ok) return true;
    } catch { /* try again */ }
    if (i < retries - 1) await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// ─── Cache ────────────────────────────────────────────────────────────────

function saveCache(data: { schemes: SchemeResult[]; insurance: InsuranceResult[]; ts: number }) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
}

function loadCache(): { schemes: SchemeResult[]; insurance: InsuranceResult[]; ts: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Content helpers ──────────────────────────────────────────────────────

function getName(item: SchemeResult | InsuranceResult, lang = 'en'): string {
  if (!item.name) return 'Unknown';
  if (typeof item.name === 'string') return item.name;
  return item.name[lang] || item.name['en'] || Object.values(item.name)[0] || 'Unknown';
}

function getDesc(item: SchemeResult, lang = 'en'): string {
  const b = item.benefits_text;
  const d = item.description;
  const src = b || d;
  if (!src) return '';
  if (typeof src === 'string') return src;
  return src[lang] || src['en'] || '';
}

function formatAmount(v: number | undefined): string {
  if (!v) return '';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000)   return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v}`;
}

// ─── Inner page ───────────────────────────────────────────────────────────

function ResultsContent() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const isOfflineParam = searchParams.get('offline') === '1';

  const [schemes,   setSchemes]   = useState<SchemeResult[]>([]);
  const [insurance, setInsurance] = useState<InsuranceResult[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [cacheAge,  setCacheAge]  = useState<Date | null>(null);
  const [tab,       setTab]       = useState<'schemes' | 'insurance'>('schemes');
  const [sessionId, setSessionId] = useState('');
  const [lang]                    = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('as_lang') || 'en') : 'en'
  );

  const loadResults = useCallback(async () => {
    setLoading(true);
    setIsOffline(false);

    const userId = typeof window !== 'undefined' ? localStorage.getItem('as_user_id') : null;

    // Check connectivity with real HTTP ping (not navigator.onLine)
    const online = !isOfflineParam && await checkConnectivity();

    if (!online || !userId) {
      const cached = loadCache();
      if (cached) {
        setSchemes(cached.schemes || []);
        setInsurance(cached.insurance || []);
        setCacheAge(new Date(cached.ts));
        setIsOffline(true);
      } else if (!userId) {
        // No profile — redirect to onboarding
        router.push('/onboarding');
        return;
      }
      setLoading(false);
      return;
    }

    try {
      const [sRes, iRes] = await Promise.all([
        fetch(`${API}/api/schemes/recommend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, limit: 10 }),
        }),
        fetch(`${API}/api/insurance/recommend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, limit: 5 }),
        }),
      ]);

      const sData = await sRes.json();
      const iData = await iRes.json();

      const s = sData.success ? (sData.data || []) : [];
      const i = iData.success ? (iData.data || []) : [];
      setSchemes(s);
      setInsurance(i);
      if (sData.session_id) setSessionId(sData.session_id);

      // Cache for offline
      saveCache({ schemes: s, insurance: i, ts: Date.now() });
    } catch {
      // Server reachable but error — show cache
      const cached = loadCache();
      if (cached) {
        setSchemes(cached.schemes || []);
        setInsurance(cached.insurance || []);
        setCacheAge(new Date(cached.ts));
        setIsOffline(true);
      }
    } finally {
      setLoading(false);
    }
  }, [isOfflineParam, router]);

  useEffect(() => { loadResults(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Log interaction event
  const logEvent = useCallback(async (
    entityId: string, entityType: 'scheme'|'insurance',
    eventType: string, rank: number,
    breakdown?: Record<string, number>
  ) => {
    const userId = localStorage.getItem('as_user_id');
    if (!userId) return;
    try {
      fetch(`${API}/api/schemes/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId, entity_id: entityId, entity_type: entityType,
          event_type: eventType, rank_position: rank, session_id: sessionId,
          score_breakdown: breakdown,
          client_event_id: `${userId}_${entityId}_${eventType}_${Date.now()}`,
        }),
      });
    } catch {}
  }, [sessionId]);

  if (loading) return <LoadingState />;

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Offline banner */}
      {isOffline && (
        <div className="bg-amber-500 text-white px-4 py-3 text-center text-sm font-semibold flex items-center justify-center gap-2">
          <span>📵</span>
          Offline — showing saved results
          {cacheAge && <span className="opacity-80 ml-1">(saved {cacheAge.toLocaleDateString()})</span>}
        </div>
      )}

      {/* Header */}
      <header className="bg-primary text-white px-5 pt-8 pb-5">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/')}
            className="text-white/80 text-sm flex items-center gap-1 min-h-[44px]">
            ← Home
          </button>
          <button onClick={() => router.push('/onboarding')}
            className="text-white/80 text-sm min-h-[44px]">
            ✏️ Edit profile
          </button>
        </div>
        <h1 className="text-2xl font-bold">Your Results</h1>
        <p className="text-white/80 text-sm mt-1">
          {schemes.length} scheme{schemes.length !== 1 ? 's' : ''} + {insurance.length} insurance plan{insurance.length !== 1 ? 's' : ''}
        </p>
      </header>

      {/* Tabs */}
      <div className="flex bg-white border-b border-gray-200 sticky top-0 z-10">
        {[
          { key: 'schemes',   label: `🌾 Schemes (${schemes.length})` },
          { key: 'insurance', label: `🛡️ Insurance (${insurance.length})` },
        ].map(t => (
          <button key={t.key}
            onClick={() => setTab(t.key as typeof tab)}
            className={`flex-1 py-4 text-base font-semibold border-b-4 transition-colors min-h-[56px] ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-gray-500'}`}
          >{t.label}</button>
        ))}
      </div>

      {/* Cards */}
      <div className="px-4 py-5">
        {tab === 'schemes' ? (
          schemes.length === 0
            ? <EmptyState onRetry={loadResults} />
            : schemes.map((s, i) => (
              <SchemeCard key={s.id || s.source_id} scheme={s} rank={i+1} lang={lang}
                onLog={(et) => logEvent(s.id, 'scheme', et, i+1, s.score_breakdown)} />
            ))
        ) : (
          insurance.length === 0
            ? <EmptyState onRetry={loadResults} />
            : insurance.map((p, i) => (
              <InsuranceCard key={p.id || p.source_id} policy={p} rank={i+1} lang={lang}
                onLog={(et) => logEvent(p.id, 'insurance', et, i+1, p.score_breakdown)} />
            ))
        )}
      </div>

      {/* Document checker CTA */}
      <div className="px-4 pb-10">
        <div className="bg-amber-50 border-2 border-amber-200 rounded-3xl p-5 text-center">
          <p className="text-4xl mb-2">📄</p>
          <h3 className="font-bold text-gray-900 text-xl mb-1">Check a Document</h3>
          <p className="text-gray-600 text-sm mb-4">Understand any agreement before you sign</p>
          <button className="btn-primary" onClick={() => router.push('/document')}>
            Take a Photo
          </button>
        </div>
      </div>
    </main>
  );
}

// ─── SchemeCard ───────────────────────────────────────────────────────────

function SchemeCard({ scheme, rank, lang, onLog }: {
  scheme: SchemeResult; rank: number; lang: string;
  onLog: (et: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const name    = getName(scheme, lang);
  const desc    = getDesc(scheme, lang);
  const score   = Math.round((scheme.score || 0) * 100);
  const benefit = scheme.benefit_amount_max || scheme.benefit_amount_min;
  const status  = scheme.eligibility_status;

  return (
    <article className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <h3 className="font-bold text-gray-900 text-lg leading-snug">{name}</h3>
          {scheme.level && (
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 font-medium ${scheme.level === 'central' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
              {scheme.level === 'central' ? '🇮🇳 Central' : '🏛️ State'}
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`text-xs font-bold px-2 py-1 rounded-full ${score >= 70 ? 'bg-green-100 text-green-800' : score >= 40 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-600'}`}>
            ⭐ {score}%
          </span>
          {status === 'likely' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Likely</span>
          )}
          {scheme._is_exploration && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">New</span>
          )}
        </div>
      </div>

      {benefit && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-green-600 font-bold text-xl">{formatAmount(benefit)}</span>
          <span className="text-gray-400 text-sm">{scheme.benefit_type === 'cash_direct' ? '/year' : ''}</span>
        </div>
      )}

      {scheme.explain_text && (
        <p className="text-sm text-gray-600 bg-green-50 rounded-xl px-3 py-2 mb-3">
          ✅ {scheme.explain_text}
        </p>
      )}

      {status === 'likely' && scheme.missing_criteria && scheme.missing_criteria.length > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
          ℹ️ Answer {scheme.missing_criteria.length} more question{scheme.missing_criteria.length > 1 ? 's' : ''} to confirm eligibility
        </p>
      )}

      {scheme.tags && scheme.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {scheme.tags.slice(0, 4).map(t => (
            <span key={t} className="bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
              {t.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {expanded && desc && (
        <p className="text-sm text-gray-700 mb-3 leading-relaxed">{desc.slice(0, 400)}</p>
      )}

      {expanded && scheme.score_breakdown && (
        <div className="bg-gray-50 rounded-2xl p-3 mb-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 mb-2">Why this score:</p>
          {Object.entries(scheme.score_breakdown)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 w-36 truncate capitalize">{k.replace(/f\d_/, '').replace(/_/g,' ')}</span>
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-2 bg-primary rounded-full" style={{ width: `${Math.round(v * 100)}%` }} />
                </div>
                <span className="text-gray-700 font-medium w-8 text-right">{Math.round(v * 100)}%</span>
              </div>
            ))}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        {scheme.application_url && (
          <a href={scheme.application_url} target="_blank" rel="noopener noreferrer"
            onClick={() => onLog('apply')}
            className="flex-1 btn-primary text-center text-sm py-3">
            Apply Now
          </a>
        )}
        <button onClick={() => { setExpanded(e => !e); onLog('click'); }}
          className="btn-secondary py-3 px-4 text-sm flex-shrink-0">
          {expanded ? '▲' : 'Details'}
        </button>
        <button onClick={() => onLog('dismiss')}
          className="py-3 px-3 text-gray-400 hover:text-gray-600 min-h-[48px] flex-shrink-0"
          aria-label="Not for me">✕</button>
      </div>
    </article>
  );
}

// ─── InsuranceCard ────────────────────────────────────────────────────────

function InsuranceCard({ policy, rank, lang, onLog }: {
  policy: InsuranceResult; rank: number; lang: string;
  onLog: (et: string) => void;
}) {
  const name  = getName(policy, lang);
  const score = Math.round((policy.score || 0) * 100);

  return (
    <article className="bg-white rounded-3xl shadow-sm border-l-4 border-l-blue-400 border border-gray-100 p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-bold text-gray-900 text-lg flex-1 leading-snug">{name}</h3>
        <span className={`text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 ${score >= 70 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
          ⭐ {score}%
        </span>
      </div>

      <div className="flex gap-5 mb-3">
        {policy.annual_premium !== undefined && (
          <div>
            <p className="text-xs text-gray-500">Annual Premium</p>
            <p className="font-bold text-lg text-amber-600">
              {policy.annual_premium === 0 ? 'FREE' : `₹${policy.annual_premium}`}
            </p>
          </div>
        )}
        {policy.coverage_amount && (
          <div>
            <p className="text-xs text-gray-500">Coverage</p>
            <p className="font-bold text-lg text-primary">{formatAmount(policy.coverage_amount)}</p>
          </div>
        )}
      </div>

      {policy.explain_text && (
        <p className="text-sm text-gray-600 bg-blue-50 rounded-xl px-3 py-2 mb-3">
          ✅ {policy.explain_text}
        </p>
      )}

      <div className="flex gap-2 mt-3">
        {policy.application_url && (
          <a href={policy.application_url} target="_blank" rel="noopener noreferrer"
            onClick={() => onLog('apply')}
            className="flex-1 btn-primary text-center text-sm py-3">
            Enrol Now
          </a>
        )}
        <button onClick={() => onLog('dismiss')}
          className="py-3 px-3 text-gray-400 hover:text-gray-600 min-h-[48px]"
          aria-label="Not for me">✕</button>
      </div>
    </article>
  );
}

// ─── Skeleton / Empty ─────────────────────────────────────────────────────

function LoadingState() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="animate-pulse space-y-4">
        {[1,2,3].map(i => (
          <div key={i} className="bg-white rounded-3xl p-5 h-40 border border-gray-100">
            <div className="h-5 bg-gray-200 rounded-xl w-3/4 mb-3" />
            <div className="h-4 bg-gray-200 rounded-xl w-1/3 mb-3" />
            <div className="h-16 bg-gray-100 rounded-xl" />
          </div>
        ))}
      </div>
    </main>
  );
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-center py-16 px-5">
      <p className="text-5xl mb-4">🔍</p>
      <p className="text-xl text-gray-600 mb-2">No results found</p>
      <p className="text-gray-400 text-sm mb-6">Try updating your profile for better matches</p>
      <div className="space-y-3">
        <button className="btn-primary" onClick={onRetry}>Try Again</button>
        <a href="/onboarding" className="btn-secondary block text-center">Update Profile</a>
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────

export default function ResultsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ResultsContent />
    </Suspense>
  );
}
