'use client';

import { useEffect, useState, Suspense, useCallback } from 'react';
import { getApiUrl } from '@/lib/config';
import { t, initLanguage } from '@/i18n';
import { useRouter } from 'next/navigation';

const API = getApiUrl();
const CACHE_KEY = 'as_results_v3';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

interface SchemeResult {
  id: string;
  name: any;
  description?: any;
  category?: string;
  ministry?: string;
  benefit_value?: number;
  benefit_amount_min?: number;
  benefit_amount_max?: number;
  application_url?: string;
  source?: string;
  documents_required?: string[];
  how_to_apply?: string;
}
interface InsuranceResult {
  id: string;
  name: any;
  description?: any;
  annual_premium?: number;
  coverage_amount?: number;
  application_url?: string;
  source?: string;
}

function saveCache(d: unknown) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data: d, ts: Date.now() })); } catch {}
}
function loadCache() {
  try {
    const r = localStorage.getItem(CACHE_KEY);
    if (!r) return null;
    const parsed = JSON.parse(r);
    if (Date.now() - parsed.ts > CACHE_TTL) { localStorage.removeItem(CACHE_KEY); return null; }
    return parsed.data;
  } catch { return null; }
}

async function checkOnline() {
  try {
    const c = new AbortController();
    setTimeout(() => c.abort(), 4000);
    const r = await fetch(`${API}/api/health`, { signal: c.signal });
    return r.ok;
  } catch { return false; }
}

function getName(item: unknown): string {
  if (!item) return 'Unknown';
  const i = item as Record<string, unknown>;
  if (!i.name) return 'Unknown';
  if (typeof i.name === 'string') return i.name;
  const n = i.name as Record<string, string>;
  // Try user's language first
  const lang = typeof window !== 'undefined' ? (localStorage.getItem('arthsathi_lang') || 'hi') : 'hi';
  return n[lang] || n.en || n.hi || Object.values(n)[0] || 'Unknown';
}

function getDesc(item: unknown): string {
  if (!item) return '';
  const i = item as Record<string, unknown>;
  const s = i.description || (i as Record<string, unknown>).benefits_text;
  if (!s) return '';
  if (typeof s === 'string') return s;
  const lang = typeof window !== 'undefined' ? (localStorage.getItem('arthsathi_lang') || 'hi') : 'hi';
  const d = s as Record<string, string>;
  return d[lang] || d.en || d.hi || '';
}

function fmt(v?: number): string {
  if (!v) return '';
  if (v >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
  return `₹${v}`;
}

function SourceBadge({ source }: { source?: string }) {
  if (!source) return null;
  const domain = source.replace(/^https?:\/\//, '').split('/')[0];
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-medium truncate max-w-full block">
      {domain}
    </span>
  );
}

function ResultsContent() {
  useEffect(() => { initLanguage(); }, []);
  const router = useRouter();
  const [schemes,   setSchemes]   = useState<SchemeResult[]>([]);
  const [insurance, setInsurance] = useState<InsuranceResult[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [offline,   setOffline]   = useState(false);
  const [tab,       setTab]       = useState<'schemes'|'insurance'>('schemes');
  const [signals,   setSignals]   = useState<{boosts: Record<string,number>, suppressions: Record<string,number>}>({ boosts: {}, suppressions: {} });

  const logInteraction = useCallback(async (schemeId: string, action: 'apply' | 'dismiss') => {
    const userId = localStorage.getItem('as_user_id');
    if (!userId) return;
    try {
      await fetch(`${API}/api/schemes/interact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, scheme_id: schemeId, action }),
      });
    } catch {}
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const userId = typeof window !== 'undefined' ? localStorage.getItem('as_user_id') : null;
    if (!userId) { router.push('/auth'); return; }
    const online = await checkOnline();

    if (!online) {
      const c = loadCache();
      if (c) { setSchemes(c.schemes || []); setInsurance(c.insurance || []); setOffline(true); }
      setLoading(false);
      return;
    }

    try {
      const [sR, iR] = await Promise.all([
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
      const sData = await sR.json().catch(() => ({ data: [] }));
      const iData = await iR.json().catch(() => ({ data: [] }));
      let s = sData.data || [];
      let ins = iData.data || [];

      if (s.length === 0) {
        const fb = await fetch(`${API}/api/schemes?limit=10`);
        s = (await fb.json().catch(() => ({ data: [] }))).data || [];
      }
      if (ins.length === 0) {
        const fb = await fetch(`${API}/api/insurance?limit=5`);
        ins = (await fb.json().catch(() => ({ data: [] }))).data || [];
      }

      setSchemes(s);
      setInsurance(ins);
      saveCache({ schemes: s, insurance: ins });

      // Fetch collaborative signals for this user
      if (userId) {
        fetch(`${API}/api/schemes/signals?user_id=${userId}`)
          .then(r => r.json())
          .then(d => { if (d.success) setSignals(d); })
          .catch(() => {});
      }
    } catch {
      const c = loadCache();
      if (c) { setSchemes(c.schemes || []); setInsurance(c.insurance || []); setOffline(true); }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <main className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="animate-pulse space-y-3 max-w-lg mx-auto">
        {[1,2,3,4].map(i => <div key={i} className="bg-white rounded-2xl h-32 border border-gray-100" />)}
      </div>
    </main>
  );

  return (
    <main className="min-h-screen bg-gray-50 pb-10">
      {offline && (
        <div className="bg-amber-500 text-white text-center text-xs py-2">
          {t('results.offline') || '📵 Offline — saved results'}
        </div>
      )}

      <header className="bg-primary text-white px-5 pt-8 pb-5">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => router.push('/')} className="text-white/80 text-sm">
            {t('results.home') || '← Home'}
          </button>
          <button onClick={() => router.push('/onboarding')} className="text-white/80 text-sm">
            ✏️ {t('results.edit_profile') || 'Edit profile'}
          </button>
        </div>
        <h1 className="text-2xl font-bold">{t('results.your_results') || 'Your Results'}</h1>
        <p className="text-white/80 text-sm mt-1">
          {schemes.length} {t('results.schemes_tab') || 'schemes'} + {insurance.length} {t('results.insurance_tab') || 'insurance'}
        </p>
      </header>

      <div className="flex bg-white border-b sticky top-0 z-10">
        {(['schemes', 'insurance'] as const).map(k => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-4 text-sm font-semibold border-b-4 transition-colors ${tab === k ? 'border-primary text-primary' : 'border-transparent text-gray-500'}`}>
            {k === 'schemes'
              ? `🌾 ${t('results.schemes_tab') || 'Schemes'} (${schemes.length})`
              : `🛡️ ${t('results.insurance_tab') || 'Insurance'} (${insurance.length})`}
          </button>
        ))}
      </div>

      <div className="px-4 py-4 max-w-lg mx-auto">
        {tab === 'schemes' ? (
          schemes.length === 0
            ? (
              <div className="text-center py-16">
                <p className="text-5xl mb-3">🔍</p>
                <p className="font-bold text-gray-700 mb-4">{t('results.no_schemes') || 'No schemes found'}</p>
                <button className="btn-primary" onClick={load}>{t('results.try_again') || 'Try Again'}</button>
              </div>
            )
            : (
              <div className="space-y-3">
                {schemes
                  .slice()
                  .sort((a, b) => {
                    const aId = String(a.id || '');
                    const bId = String(b.id || '');
                    const aScore = (signals.boosts[aId] || 0) - (signals.suppressions[aId] || 0);
                    const bScore = (signals.boosts[bId] || 0) - (signals.suppressions[bId] || 0);
                    return bScore - aScore;
                  })
                  .map((s, i) => (
                    <SchemeCard
                      key={s.id || i}
                      scheme={s}
                      onApply={() => logInteraction(s.id, 'apply')}
                      onDismiss={() => logInteraction(s.id, 'dismiss')}
                    />
                  ))
                }</div>
            )
        ) : (
          insurance.length === 0
            ? (
              <div className="text-center py-16">
                <p className="text-5xl mb-3">🛡️</p>
                <p className="font-bold text-gray-700 mb-4">{t('results.no_insurance') || 'No insurance plans found'}</p>
                <button className="btn-primary" onClick={load}>{t('results.try_again') || 'Try Again'}</button>
              </div>
            )
            : (
              <div className="space-y-3">
                {insurance.map((p, i) => <InsuranceCard key={p.id || i} policy={p} />)}
              </div>
            )
        )}
      </div>
    </main>
  );
}

function SchemeCard({ scheme, onApply, onDismiss }: { scheme: SchemeResult; onApply: () => void; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [actioned, setActioned] = useState<'apply'|'dismiss'|null>(null);
  const [speaking, setSpeaking] = useState(false);
  const name    = getName(scheme);
  const desc    = getDesc(scheme);
  const benefit = (scheme as SchemeResult).benefit_value || scheme.benefit_amount_max || scheme.benefit_amount_min;

  const lang = typeof window !== 'undefined' ? (localStorage.getItem('arthsathi_lang') || 'hi') : 'hi';

  function speakScheme() {
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const text = `${name}. ${desc ? desc.slice(0, 300) : ''}${benefit ? `. Labh: rupaye ${benefit}` : ''}`;
    const utter = new SpeechSynthesisUtterance(text);
    const locales: Record<string, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
    utter.lang = locales[lang] || 'hi-IN';
    utter.rate = 0.85;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  // Stop speaking when card unmounts
  if (typeof window !== 'undefined') {
    // cleanup on next render if speaking
  }

  if (actioned === 'dismiss') {
    return (
      <div className="bg-gray-50 rounded-2xl border border-gray-100 p-3 flex items-center justify-between opacity-60">
        <p className="text-sm text-gray-400 truncate">{name}</p>
        <button onClick={() => { setActioned(null); }} className="text-xs text-blue-500 underline ml-2 shrink-0">Undo</button>
      </div>
    );
  }

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        {scheme.category && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold shrink-0">
            {scheme.category}
          </span>
        )}
        <SourceBadge source={scheme.source} />
      </div>

      <h3 className="font-bold text-gray-900 text-base leading-snug">{name}</h3>

      {scheme.ministry && (
        <p className="text-xs text-gray-400 truncate">{scheme.ministry}</p>
      )}

      {benefit && (
        <div className="bg-green-50 rounded-lg px-3 py-1.5 text-center self-start">
          <span className="text-green-700 font-bold text-sm">{fmt(benefit)}</span>
        </div>
      )}

      {/* Description — show 400 chars by default, full on expand */}
      {desc && (
        <p className="text-sm text-gray-600 leading-relaxed">
          {expanded ? desc : desc.slice(0, 400)}
          {!expanded && desc.length > 400 && '...'}
        </p>
      )}

      {/* Documents required */}
      {expanded && scheme.documents_required && scheme.documents_required.length > 0 && (
        <div className="bg-amber-50 rounded-xl p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">📋 Documents needed:</p>
          <ul className="text-xs text-amber-700 space-y-0.5">
            {scheme.documents_required.map((doc, i) => (
              <li key={i}>• {doc}</li>
            ))}
          </ul>
        </div>
      )}

      {/* How to apply */}
      {expanded && scheme.how_to_apply && (
        <div className="bg-blue-50 rounded-xl p-3">
          <p className="text-xs font-semibold text-blue-800 mb-1">📝 How to apply:</p>
          <p className="text-xs text-blue-700">{scheme.how_to_apply}</p>
        </div>
      )}

      {scheme.application_url && (
        <a href={scheme.application_url} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-600 underline mb-1 block truncate">
          🔗 {scheme.application_url.replace(/^https?:\/\//, '').slice(0, 50)}
        </a>
      )}

      <div className="flex gap-2 mt-1">
        <button
          onClick={() => { setActioned('dismiss'); onDismiss(); }}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 text-lg shrink-0"
          title="Not relevant"
        >✕</button>
        {/* 🔊 Listen button */}
        <button
          onClick={speakScheme}
          className={`w-10 h-10 flex items-center justify-center rounded-xl text-lg shrink-0 transition-colors ${speaking ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'}`}
          title={speaking ? 'Stop' : 'Listen'}
        >{speaking ? '⏹' : '🔊'}</button>
        {scheme.application_url && (
          <a href={scheme.application_url} target="_blank" rel="noopener noreferrer"
            onClick={() => { setActioned('apply'); onApply(); }}
            className="flex-1 bg-green-600 text-white text-sm font-semibold rounded-xl py-2.5 text-center">
            {t('results.apply') || 'Apply'}
          </a>
        )}
        {(desc && desc.length > 400) || scheme.documents_required?.length ? (
          <button onClick={() => setExpanded(e => !e)}
            className="bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl py-2.5 px-3">
            {expanded ? (t('results.less') || 'Less') : (t('results.more') || 'More')}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function InsuranceCard({ policy }: { policy: InsuranceResult }) {
  const name = getName(policy);
  const desc = getDesc(policy);
  const [speaking, setSpeaking] = useState(false);
  const lang = typeof window !== 'undefined' ? (localStorage.getItem('arthsathi_lang') || 'hi') : 'hi';

  function speakPolicy() {
    if (!('speechSynthesis' in window)) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    window.speechSynthesis.cancel();
    const premium = policy.annual_premium === 0 ? 'muft' : `rupaye ${policy.annual_premium} saalik`;
    const cover = policy.coverage_amount ? `. Cover rupaye ${policy.coverage_amount}` : '';
    const text = `${name}. ${desc ? desc.slice(0, 200) : ''}. Premium ${premium}${cover}`;
    const utter = new SpeechSynthesisUtterance(text);
    const locales: Record<string, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
    utter.lang = locales[lang] || 'hi-IN';
    utter.rate = 0.85;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  }

  return (
    <article className="bg-white rounded-2xl shadow-sm border-t-4 border-t-blue-500 border border-gray-100 p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold text-gray-900 text-base leading-snug flex-1">{name}</h3>
        <SourceBadge source={policy.source} />
      </div>

      {desc && <p className="text-sm text-gray-600 leading-relaxed">{desc}</p>}

      <div className="grid grid-cols-2 gap-2">
        {policy.annual_premium !== undefined && (
          <div className="bg-amber-50 rounded-lg px-2 py-2 text-center">
            <p className="text-[10px] text-gray-500">{t('insurance.premium')||'Premium'}</p>
            <p className="font-bold text-sm text-amber-600">
              {Number(policy.annual_premium) === 0 ? 'FREE' : `₹${policy.annual_premium}/yr`}
            </p>
          </div>
        )}
        {policy.coverage_amount && (
          <div className="bg-blue-50 rounded-lg px-2 py-2 text-center">
            <p className="text-[10px] text-gray-500">{t('insurance.coverage')||'Cover'}</p>
            <p className="font-bold text-sm text-blue-600">{fmt(policy.coverage_amount)}</p>
          </div>
        )}
      </div>

      {policy.application_url && (
        <div className="flex gap-2">
          <button
            onClick={speakPolicy}
            className={`w-10 h-10 flex items-center justify-center rounded-xl text-lg shrink-0 transition-colors ${speaking ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'}`}
            title={speaking ? 'Stop' : 'Listen'}
          >{speaking ? '⏹' : '🔊'}</button>
          <a href={policy.application_url} target="_blank" rel="noopener noreferrer"
            className="flex-1 bg-blue-600 text-white text-sm font-semibold rounded-xl py-2.5 text-center">
            {t('results.enrol') || 'Enrol Now'}
          </a>
        </div>
      )}
      {!policy.application_url && (
        <button
          onClick={speakPolicy}
          className={`w-10 h-10 flex items-center justify-center rounded-xl text-lg transition-colors ${speaking ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-600'}`}
          title={speaking ? 'Stop' : 'Listen'}
        >{speaking ? '⏹' : '🔊'}</button>
      )}
    </article>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <ResultsContent />
    </Suspense>
  );
}
