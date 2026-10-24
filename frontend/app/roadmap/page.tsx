'use client';

import { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/config';
import { useRouter } from 'next/navigation';
import { t, initLanguage } from '@/i18n';

const API = getApiUrl();

interface Action {
  title: string;
  type: string;
  description: string;
  estimated_benefit: number;
  effort_level: 'low' | 'medium' | 'high';
  deadline_days: number;
  link?: string;
}

interface Roadmap {
  current_state: { monthly_income: number; monthly_expenses: number; monthly_savings: number; emergency_fund_target: number };
  budget_breakdown: { needs: number; wants: number; savings: number; emergency: number };
  goals: any[];
  ai_summary: string | null;
  recommendations: { immediate_actions: Action[]; short_term_plans: Action[]; long_term_plans: Action[] };
}

function fmt(v?: number) {
  if (!v) return '₹0';
  if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L';
  if (v >= 1000) return '₹' + (v / 1000).toFixed(1) + 'K';
  return '₹' + v;
}

const TYPE_EMOJI: Record<string, string> = {
  habit: '📝', savings_plan: '💰', insurance: '🛡️',
  banking: '🏦', goal: '🎯', investment: '📈', default: '✅'
};
const EFFORT_COLOR = { low: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', high: 'bg-red-100 text-red-700' };

function ActionCard({ action }: { action: Action }) {
  const desc = typeof action.description === 'string' ? action.description : '';
  const title = typeof action.title === 'string' ? action.title : String(action.title || '');
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
      <div className="flex items-start gap-3">
        <span className="text-2xl flex-shrink-0">{TYPE_EMOJI[action.type] || TYPE_EMOJI.default}</span>
        <div className="flex-1">
          <h4 className="font-bold text-gray-900 text-sm leading-snug mb-1">{title}</h4>
          {desc && <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap mt-3">
        {action.estimated_benefit > 0 && (
          <span className="text-xs bg-green-50 text-green-700 font-semibold px-2 py-1 rounded-full">
            💰 {fmt(action.estimated_benefit)}
          </span>
        )}
        <span className={'text-xs font-semibold px-2 py-1 rounded-full ' + (EFFORT_COLOR[action.effort_level] || EFFORT_COLOR.medium)}>
          {action.effort_level === 'low' ? `⚡ ${t('roadmap.effort_low')||'Easy'}` : action.effort_level === 'medium' ? `⏱ ${t('roadmap.effort_medium')||'Medium'}` : `💪 ${t('roadmap.effort_high')||'Hard'}`}
        </span>
        <span className="text-xs text-gray-400">{t('roadmap.days')||'Within'} {action.deadline_days} {t('roadmap.days')||'days'}</span>
      </div>
      {action.link && (
        <a href={action.link} target="_blank" rel="noopener noreferrer"
          className="mt-3 bg-primary text-white text-xs font-semibold rounded-xl py-2 text-center block">
          Learn More →
        </a>
      )}
    </div>
  );
}

export default function RoadmapPage() {
  const router = useRouter();
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initLanguage();
    const userId = typeof window !== 'undefined' ? localStorage.getItem('as_user_id') : null;
    if (!userId) { router.push('/auth'); return; }
    fetch(`${API}/api/roadmap/${userId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setRoadmap(d.data); else setError(d.error?.message || 'Could not load roadmap'); })
      .catch(() => setError('Could not connect to server'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-5xl mb-4">📊</div>
        <p className="text-gray-600 font-medium">Building your financial plan...</p>
      </div>
    </main>
  );

  if (error || !roadmap) return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-5">
      <div className="text-center">
        <p className="text-5xl mb-4">⚠️</p>
        <p className="text-gray-700 font-medium mb-4">{error || 'Could not load roadmap'}</p>
        <button onClick={() => router.push('/onboarding')} className="bg-primary text-white px-6 py-3 rounded-xl font-semibold">
          Complete Profile First
        </button>
      </div>
    </main>
  );

  const { current_state, budget_breakdown, recommendations, ai_summary } = roadmap;
  const { immediate_actions, short_term_plans, long_term_plans } = recommendations;

  return (
    <main className="min-h-screen bg-gray-50 pb-10">
      <header className="bg-primary text-white px-5 pt-8 pb-5">
        <button onClick={() => router.push('/')} className="text-white/80 text-sm mb-3 block">← Home</button>
        <h1 className="text-2xl font-bold">📊 {t('roadmap.title') || 'Your Financial Roadmap'}</h1>
        <p className="text-white/80 text-sm mt-1">{t('roadmap.subtitle') || 'Personalized money plan based on your profile'}</p>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* AI Advice */}
        {ai_summary && (
          <div className="bg-primary/10 border-2 border-primary/20 rounded-2xl p-4">
            <p className="text-sm font-semibold text-primary mb-1">💡 Personalized Advice</p>
            <p className="text-sm text-gray-700 leading-relaxed">{ai_summary}</p>
          </div>
        )}

        {/* Current Financial Snapshot */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="font-bold text-gray-900 text-lg mb-4">📈 {t('roadmap.current_state') || 'Your Money Snapshot'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">{t('roadmap.monthly_income')||'Monthly Income'}</p>
              <p className="font-bold text-green-700">{fmt(current_state.monthly_income)}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">{t('roadmap.monthly_expenses')||'Est. Expenses'}</p>
              <p className="font-bold text-red-600">{fmt(current_state.monthly_expenses)}</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">{t('roadmap.monthly_savings')||'Can Save/Month'}</p>
              <p className="font-bold text-blue-700">{fmt(current_state.monthly_savings)}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <p className="text-[10px] text-gray-500 mb-1">{t('roadmap.emergency')||'Emergency Fund Target'}</p>
              <p className="font-bold text-amber-700">{fmt(current_state.emergency_fund_target)}</p>
            </div>
          </div>
        </div>

        {/* 50/20/20/10 Budget Guide */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
          <h2 className="font-bold text-gray-900 text-lg mb-1">💼 {t('roadmap.title') || 'Suggested Budget Split'}</h2>
          <p className="text-xs text-gray-500 mb-4">{t('roadmap.subtitle')||'Based on your'} ₹{current_state.monthly_income.toLocaleString('en-IN')}/month income</p>
          <div className="space-y-3">
            {[
              { label: t('roadmap.needs')||'Needs (food, rent, transport)', value: budget_breakdown.needs, color: 'bg-blue-500', pct: '50%' },
              { label: t('roadmap.wants')||'Wants (entertainment, extras)', value: budget_breakdown.wants, color: 'bg-purple-400', pct: '20%' },
              { label: t('roadmap.savings_inv')||'Savings & investments', value: budget_breakdown.savings, color: 'bg-green-500', pct: '20%' },
              { label: t('roadmap.emergency')||'Emergency fund', value: budget_breakdown.emergency, color: 'bg-amber-500', pct: '10%' },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${item.color}`} />
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-700">{item.label}</span>
                    <span className="font-bold text-gray-900">{fmt(item.value)} <span className="text-gray-400 font-normal">({item.pct})</span></span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-2 rounded-full ${item.color}`} style={{ width: item.pct }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Immediate Actions */}
        {immediate_actions.length > 0 && (
          <section>
            <h2 className="font-bold text-gray-900 text-lg mb-3">🔥 {t('roadmap.immediate_actions') || 'Start This Week'}</h2>
            <div className="space-y-3">
              {immediate_actions.map((a, i) => <ActionCard key={i} action={a} />)}
            </div>
          </section>
        )}

        {/* Short Term */}
        {short_term_plans.length > 0 && (
          <section>
            <h2 className="font-bold text-gray-900 text-lg mb-3">📅 {t('roadmap.short_term') || 'Next 3-12 Months'}</h2>
            <div className="space-y-3">
              {short_term_plans.map((a, i) => <ActionCard key={i} action={a} />)}
            </div>
          </section>
        )}

        {/* Long Term Goals */}
        {long_term_plans.length > 0 && (
          <section>
            <h2 className="font-bold text-gray-900 text-lg mb-3">🎯 {t('roadmap.long_term') || 'Long-Term (1+ Year)'}</h2>
            <div className="space-y-3">
              {long_term_plans.map((a, i) => <ActionCard key={i} action={a} />)}
            </div>
          </section>
        )}

        {/* Tip box */}
        <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4">
          <p className="text-sm font-bold text-amber-800 mb-1">💡 {t('roadmap.golden_rule') || 'Golden Rule'}</p>
          <p className="text-xs text-amber-700 leading-relaxed">
            {t('roadmap.golden_rule_desc') || 'Pay yourself first — save before you spend. Even Rs.100/month saved consistently builds a habit that will change your financial future.'}
          </p>
        </div>

        <button onClick={() => router.push('/results')} className="w-full bg-gray-100 text-gray-700 font-semibold rounded-2xl py-3 text-sm">
          {t('roadmap.view_schemes') || 'View Eligible Schemes & Insurance →'}
        </button>

      </div>
    </main>
  );
}