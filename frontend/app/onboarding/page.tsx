'use client';
/**
 * ArthSathi — Adaptive Onboarding Page (v2)
 *
 * Questions are driven entirely by data from the shared i18n/questions.json
 * and the questions definition in i18n/questions.json (structure).
 * - Language is selected first; every subsequent question renders in that language.
 * - Branching: only questions relevant to earlier answers are shown.
 * - Voice mode: questions read aloud via browser speechSynthesis, mic input
 *   sends to /api/voice/stt, result is confirmed before proceeding.
 * - Large touch targets (min 56px), icon-first, one question per screen.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { LANGUAGES, type LangCode, setLanguage as persistLang, setMode as persistMode, getSavedLanguage, getSavedMode } from '../../lib/i18n';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Types ────────────────────────────────────────────────────────────────

type InteractionMode = 'text' | 'voice';

interface Profile {
  preferred_language: LangCode;
  interaction_mode: InteractionMode;
  full_name: string;
  phone_number: string;
  state: string;
  district: string;
  age: string;
  gender: string;
  caste_category: string;
  occupation: string;
  monthly_income: string;
  ration_card_type: string;
  has_bank_account: boolean | null;
  has_jan_dhan_account: boolean | null;
  has_aadhaar: boolean | null;
  land_holding_acres: string;
  has_disability: boolean | null;
  disability_type: string;
  is_widow: boolean | null;
  has_girl_child: boolean | null;
  is_student: boolean | null;
  education_level: string;
  num_dependents: string;
  financial_goal: string;
  goal_amount: string;
  urgency_level: string;
}

const EMPTY: Profile = {
  preferred_language: 'hi', interaction_mode: 'voice',
  full_name: '', phone_number: '', state: '', district: '',
  age: '', gender: '', caste_category: '', occupation: '',
  monthly_income: '', ration_card_type: '',
  has_bank_account: null, has_jan_dhan_account: null, has_aadhaar: null,
  land_holding_acres: '', has_disability: null, disability_type: '',
  is_widow: null, has_girl_child: null, is_student: null,
  education_level: '', num_dependents: '',
  financial_goal: '', goal_amount: '', urgency_level: '',
};

// Indian states list
const STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh',
  'Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka',
  'Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram',
  'Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana',
  'Tripura','Uttar Pradesh','Uttarakhand','West Bengal',
  'Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh',
  'Andaman and Nicobar Islands','Dadra and Nagar Haveli','Lakshadweep',
];

// Step definitions
type StepType = 'lang_select'|'mode_select'|'text'|'choice'|'choice_grid'|
                'yesno'|'number'|'state_select'|'income_band'|'ration_card'|
                'goal_select'|'urgency_scale';

interface StepDef {
  id: keyof Profile;
  type: StepType;
  icon: string;
  required?: boolean;
  show?: (p: Profile) => boolean;
}

const STEPS: StepDef[] = [
  { id: 'preferred_language', type: 'lang_select',   icon: '🌐', required: true },
  { id: 'interaction_mode',   type: 'mode_select',   icon: '🎤', required: true },
  { id: 'state',              type: 'state_select',  icon: '📍', required: true },
  { id: 'age',                type: 'number',        icon: '🎂', required: true },
  { id: 'gender',             type: 'choice',        icon: '👤' },
  { id: 'caste_category',     type: 'choice',        icon: '📋' },
  { id: 'occupation',         type: 'choice_grid',   icon: '💼', required: true },
  { id: 'monthly_income',     type: 'income_band',   icon: '💰', required: true },
  { id: 'ration_card_type',   type: 'ration_card',   icon: '🪪' },
  { id: 'has_bank_account',   type: 'yesno',         icon: '🏦' },
  { id: 'has_jan_dhan_account',type:'yesno',          icon: '🏦', show: (p) => p.has_bank_account === true },
  { id: 'has_aadhaar',        type: 'yesno',         icon: '🪪' },
  { id: 'land_holding_acres', type: 'number',        icon: '🌾', show: (p) => ['farmer','marginal_farmer'].includes(p.occupation) },
  { id: 'has_disability',     type: 'yesno',         icon: '♿' },
  { id: 'disability_type',    type: 'choice',        icon: '🩺', show: (p) => p.has_disability === true },
  { id: 'is_widow',           type: 'yesno',         icon: '💙', show: (p) => p.gender === 'female' },
  { id: 'has_girl_child',     type: 'yesno',         icon: '👧', show: (p) => p.gender === 'female' },
  { id: 'is_student',         type: 'yesno',         icon: '📚', show: (p) => parseInt(p.age || '99') <= 30 },
  { id: 'education_level',    type: 'choice',        icon: '🎓', show: (p) => p.is_student === true || p.occupation === 'student' },
  { id: 'num_dependents',     type: 'number',        icon: '👨‍👩‍👧' },
  { id: 'financial_goal',     type: 'goal_select',   icon: '🎯', required: true },
  { id: 'goal_amount',        type: 'number',        icon: '💵' },
  { id: 'urgency_level',      type: 'urgency_scale', icon: '⚡', required: true },
];

function getActiveSteps(p: Profile) {
  return STEPS.filter(s => !s.show || s.show(p));
}

// ─── Question text lookup ─────────────────────────────────────────────────

type QData = Record<string, unknown>;

function q(data: QData, stepId: string, field: string, fallback = ''): string {
  const step = data[stepId];
  if (!step || typeof step !== 'object') return fallback;
  const obj = step as Record<string, unknown>;
  const val = obj[field];
  return typeof val === 'string' ? val : fallback;
}

function qOptions(data: QData, stepId: string): Record<string, string> {
  const step = data[stepId];
  if (!step || typeof step !== 'object') return {};
  const opts = (step as Record<string, unknown>).options;
  if (!opts || typeof opts !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (v && typeof v === 'object' && 'label' in (v as object)) {
      out[k] = String((v as Record<string, unknown>).label);
    }
  }
  return out;
}

function common(data: QData, key: string): string {
  const c = data.common;
  if (!c || typeof c !== 'object') return key;
  const val = (c as Record<string, unknown>)[key];
  return typeof val === 'string' ? val : key;
}

// ─── TTS helper ──────────────────────────────────────────────────────────

function speak(text: string, lang: LangCode) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const locales: Record<LangCode, string> = {
    hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', en: 'en-IN',
  };
  utter.lang = locales[lang] || 'hi-IN';
  utter.rate = 0.85;
  window.speechSynthesis.speak(utter);
}

// ─── Component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [profile, setProfile]   = useState<Profile>({ ...EMPTY });
  const [stepIdx, setStepIdx]   = useState(0);
  const [qData, setQData]       = useState<QData>({});
  const [submitting, setSub]    = useState(false);
  const [error, setError]       = useState('');
  const [recording, setRec]     = useState(false);
  const [voiceText, setVoiceTxt]= useState('');
  const mediaRef                = useRef<MediaRecorder | null>(null);
  const chunksRef               = useRef<Blob[]>([]);

  // Load translations on language change
  useEffect(() => {
    const lang = profile.preferred_language;
    fetch(`${API}/api/i18n/${lang}/questions`)
      .then(r => r.ok ? r.json() : fetch(`${API}/api/i18n/en/questions`).then(r2 => r2.json()))
      .then(setQData)
      .catch(() => {});
  }, [profile.preferred_language]);

  // Restore saved progress
  useEffect(() => {
    const saved = localStorage.getItem('as_profile');
    if (saved) {
      try { setProfile({ ...EMPTY, ...JSON.parse(saved) }); } catch {}
    }
    const savedLang = getSavedLanguage();
    const savedMode = getSavedMode();
    setProfile(p => ({ ...p, preferred_language: savedLang, interaction_mode: savedMode }));
  }, []);

  // Auto-save
  useEffect(() => {
    localStorage.setItem('as_profile', JSON.stringify(profile));
  }, [profile]);

  const activeSteps = getActiveSteps(profile);
  const step = activeSteps[stepIdx];
  const isLast = stepIdx === activeSteps.length - 1;
  const progress = ((stepIdx + 1) / activeSteps.length) * 100;

  // Auto-read question in voice mode
  useEffect(() => {
    if (profile.interaction_mode === 'voice' && qData && step) {
      const text = q(qData, step.id, 'question');
      if (text) setTimeout(() => speak(text, profile.preferred_language), 300);
    }
  }, [stepIdx, qData]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((field: keyof Profile, val: unknown) => {
    setProfile(p => ({ ...p, [field]: val }));
    setError('');
  }, []);

  const handleNext = async () => {
    if (step.required) {
      const val = profile[step.id];
      if (val === '' || val === null || val === undefined) {
        setError('Please answer this question to continue');
        return;
      }
    }
    if (isLast) {
      await submit();
    } else {
      setStepIdx(i => i + 1);
    }
  };

  const submit = async () => {
    setSub(true);
    try {
      // 1. Create user
      const uRes = await fetch(`${API}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: profile.phone_number || null,
          full_name: profile.full_name || null,
          state: profile.state,
          district: profile.district,
          preferred_language: profile.preferred_language,
          interaction_mode: profile.interaction_mode,
        }),
      });
      if (!uRes.ok) throw new Error('Could not save user');
      const uData = await uRes.json();
      const userId = uData.data.id;
      localStorage.setItem('as_user_id', userId);

      // 2. Save financial profile
      const monthlyIncome = parseFloat(profile.monthly_income) || 0;
      const pRes = await fetch(`${API}/api/users/${userId}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: parseInt(profile.age) || null,
          gender: profile.gender || null,
          caste_category: profile.caste_category || null,
          occupation: profile.occupation || null,
          monthly_income: monthlyIncome,
          annual_income: monthlyIncome * 12,
          ration_card_type: profile.ration_card_type || null,
          is_bpl: ['aay', 'phh'].includes(profile.ration_card_type),
          has_bank_account: profile.has_bank_account,
          has_jan_dhan_account: profile.has_jan_dhan_account,
          has_aadhaar: profile.has_aadhaar,
          land_holding_acres: parseFloat(profile.land_holding_acres) || 0,
          has_disability: profile.has_disability,
          disability_type: profile.disability_type || null,
          is_widow: profile.is_widow,
          has_girl_child: profile.has_girl_child,
          is_student: profile.is_student || profile.occupation === 'student',
          education_level: profile.education_level || null,
          num_dependents: parseInt(profile.num_dependents) || 0,
          financial_goal: profile.financial_goal,
          goal_amount: parseFloat(profile.goal_amount) || null,
          urgency_level: parseInt(profile.urgency_level) || 3,
        }),
      });
      if (!pRes.ok) throw new Error('Could not save profile');

      router.push('/results');
    } catch {
      // Queue offline, redirect anyway
      localStorage.setItem('as_offline_profile', JSON.stringify(profile));
      router.push('/results?offline=1');
    } finally {
      setSub(false);
    }
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec    = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const fd   = new FormData();
        fd.append('audio', blob, 'rec.webm');
        fd.append('language', profile.preferred_language);
        try {
          const r = await fetch(`${API}/api/voice/stt`, { method: 'POST', body: fd });
          const d = await r.json();
          if (d.text?.trim()) setVoiceTxt(d.text.trim());
        } catch {
          setError('Voice not understood. Please try again or type.');
        }
        setRec(false);
      };
      rec.start();
      mediaRef.current = rec;
      setRec(true);
    } catch {
      setError('Microphone access denied. Please allow microphone or use text mode.');
    }
  };

  const stopRecording = () => { mediaRef.current?.stop(); };

  if (!step) return null;

  const questionText  = q(qData, step.id, 'question', step.id);
  const hintText      = q(qData, step.id, 'hint', '');
  const options       = qOptions(qData, step.id);
  const commonYes     = common(qData, 'yes') || 'Yes';
  const commonNo      = common(qData, 'no') || 'No';
  const commonNext    = common(qData, 'next') || 'Next';
  const commonBack    = common(qData, 'back') || 'Back';
  const commonFinish  = common(qData, 'finish') || 'See My Results';
  const commonStep    = (common(qData, 'step') || 'Step {{current}} of {{total}}')
    .replace('{{current}}', String(stepIdx + 1))
    .replace('{{total}}', String(activeSteps.length));

  const val = profile[step.id];

  return (
    <main className="min-h-screen bg-white flex flex-col max-w-lg mx-auto">
      {/* Progress bar */}
      <div className="h-2 bg-gray-100 sticky top-0 z-10">
        <div className="h-2 bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }} />
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-gray-400 text-sm font-medium">{commonStep}</span>
        {profile.interaction_mode === 'voice' && (
          <button
            aria-label="Replay question"
            onClick={() => speak(questionText, profile.preferred_language)}
            className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-lg"
          >🔊</button>
        )}
      </header>

      {/* Question */}
      <div className="flex-1 px-5 pt-4 pb-6 flex flex-col">
        <div className="flex items-start gap-3 mb-6">
          <span className="text-4xl flex-shrink-0">{step.icon}</span>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 leading-snug">{questionText}</h2>
            {hintText && <p className="text-gray-500 text-base mt-1">{hintText}</p>}
          </div>
        </div>

        {/* Input */}
        <div className="flex-1">
          <StepInput
            step={step}
            val={val}
            options={options}
            qData={qData}
            profile={profile}
            onChange={update}
            yes={commonYes}
            no={commonNo}
          />
        </div>

        {/* Voice input */}
        {profile.interaction_mode === 'voice' && ['text','number'].includes(step.type) && (
          <div className="mt-5 flex flex-col items-center gap-2">
            <button
              onPointerDown={startRecording}
              onPointerUp={stopRecording}
              className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl text-white shadow-lg transition-transform active:scale-95 ${recording ? 'bg-red-500 voice-recording' : 'bg-primary'}`}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
            >{recording ? '🔴' : '🎤'}</button>
            <p className="text-sm text-gray-500">{recording ? (common(qData,'listening')||'Listening...') : (common(qData,'tap_to_speak')||'Tap to speak')}</p>
            {voiceText && (
              <div className="w-full bg-gray-50 border rounded-2xl p-3 mt-2 flex items-center justify-between gap-3">
                <span className="text-base text-gray-800">"{voiceText}"</span>
                <button
                  className="bg-primary text-white px-4 py-2 rounded-xl text-sm font-semibold"
                  onClick={() => {
                    update(step.id, voiceText);
                    setVoiceTxt('');
                  }}
                >Use ✓</button>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 text-red-600 text-base font-medium" role="alert">{error}</p>
        )}
      </div>

      {/* Navigation */}
      <div className="px-5 pb-8 pt-2 space-y-3 safe-padding border-t border-gray-100">
        <button
          onClick={handleNext}
          disabled={submitting}
          className="btn-primary"
        >
          {submitting ? (common(qData,'loading')||'Loading...') : isLast ? commonFinish : commonNext}
        </button>
        {stepIdx > 0 && (
          <button
            onClick={() => setStepIdx(i => Math.max(0, i - 1))}
            disabled={submitting}
            className="btn-secondary"
          >{commonBack}</button>
        )}
      </div>
    </main>
  );
}

// ─── StepInput ────────────────────────────────────────────────────────────

interface SIProps {
  step: StepDef;
  val: unknown;
  options: Record<string, string>;
  qData: QData;
  profile: Profile;
  onChange: (f: keyof Profile, v: unknown) => void;
  yes: string;
  no: string;
}

function StepInput({ step, val, options, profile, onChange, yes, no, qData }: SIProps) {
  const id = step.id;

  if (step.type === 'lang_select') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {(Object.entries(LANGUAGES) as [LangCode, { native: string }][]).map(([code, info]) => (
          <button key={code}
            onClick={() => { onChange(id, code); persistLang(code); }}
            className={`py-5 rounded-2xl border-2 text-xl font-bold transition-all ${val === code ? 'border-primary bg-primary/10 text-primary' : 'border-gray-200 text-gray-700'}`}
          >{info.native}</button>
        ))}
      </div>
    );
  }

  if (step.type === 'mode_select') {
    const modeOptions = [
      { value: 'text',  icon: '⌨️', label: options['text']  || 'Type & Read',    desc: 'Type answers' },
      { value: 'voice', icon: '🎤', label: options['voice'] || 'Speak & Listen', desc: 'Speak answers' },
    ];
    return (
      <div className="space-y-4">
        {modeOptions.map(o => (
          <button key={o.value}
            onClick={() => { onChange(id, o.value); persistMode(o.value as 'text'|'voice'); }}
            className={`w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all text-left ${val === o.value ? 'border-primary bg-primary/10' : 'border-gray-200'}`}
          >
            <span className="text-5xl">{o.icon}</span>
            <div>
              <p className="font-bold text-xl text-gray-900">{o.label}</p>
              <p className="text-gray-500 text-base">{o.desc}</p>
            </div>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'state_select') {
    return (
      <select
        className="form-input"
        value={String(val || '')}
        onChange={e => onChange(id, e.target.value)}
      >
        <option value="">— Select State —</option>
        {STATES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  }

  if (step.type === 'yesno') {
    return (
      <div className="flex gap-4">
        {[{ v: true, label: yes, icon: '✅' }, { v: false, label: no, icon: '❌' }].map(o => (
          <button key={String(o.v)}
            onClick={() => onChange(id, o.v)}
            className={`flex-1 py-6 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all ${val === o.v ? 'border-primary bg-primary/10' : 'border-gray-200'}`}
          >
            <span className="text-4xl">{o.icon}</span>
            <span className="font-bold text-xl text-gray-900">{o.label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'income_band') {
    const incomeStep = (qData as Record<string, unknown>).monthly_income as Record<string, unknown>;
    const incomeOpts = incomeStep?.options as Record<string, string> || options;
    const ICONS: Record<string, string> = { '0':'0️⃣','2000':'1️⃣','5000':'2️⃣','8000':'3️⃣','12000':'4️⃣','20000':'5️⃣','30000':'6️⃣' };
    return (
      <div className="space-y-3">
        {Object.entries(incomeOpts).map(([v, label]) => (
          <button key={v}
            onClick={() => onChange(id, v)}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all ${val === v ? 'border-primary bg-primary/10' : 'border-gray-200'}`}
          >
            <span className="text-3xl">{ICONS[v] || '💰'}</span>
            <span className="text-lg font-medium text-gray-900">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'ration_card') {
    const CARD_COLORS: Record<string, string> = {
      aay: 'bg-yellow-100 border-yellow-400',
      phh: 'bg-red-100 border-red-400',
      nphh: 'bg-green-100 border-green-400',
      annapurna: 'bg-blue-100 border-blue-400',
      state_other: 'bg-purple-100 border-purple-400',
      none: 'bg-gray-100 border-gray-400',
      applied: 'bg-orange-100 border-orange-400',
    };
    const CARD_ICONS: Record<string, string> = {
      aay:'🟡', phh:'🔴', nphh:'🟢', annapurna:'🔵', state_other:'🟣', none:'⚪', applied:'🟠',
    };
    return (
      <div className="space-y-3">
        {Object.entries(options).map(([v, label]) => (
          <button key={v}
            onClick={() => onChange(id, v)}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all ${CARD_COLORS[v] || 'border-gray-200'} ${val === v ? 'ring-2 ring-primary' : ''}`}
          >
            <span className="text-3xl">{CARD_ICONS[v] || '🪪'}</span>
            <span className="text-base font-medium text-gray-900">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'choice_grid') {
    const OCCI: Record<string, string> = {
      farmer:'🌾', marginal_farmer:'🌱', farm_laborer:'🚜', fisherman:'🎣',
      weaver:'🧵', artisan:'🔨', self_employed:'🛒', street_vendor:'🛍️',
      daily_wage:'👷', construction_worker:'🧱', domestic_worker:'🏠',
      small_trader:'🏪', student:'📚', homemaker:'👪', unemployed:'🔍', other:'💼',
    };
    return (
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(options).map(([v, label]) => (
          <button key={v}
            onClick={() => onChange(id, v)}
            className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${val === v ? 'border-primary bg-primary/10' : 'border-gray-200'}`}
          >
            <span className="text-3xl flex-shrink-0">{OCCI[v] || '💼'}</span>
            <span className="text-sm font-medium text-gray-900 leading-tight">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'goal_select') {
    const GOALI: Record<string, string> = {
      farming:'🌾', housing:'🏠', health:'🏥', education:'📚',
      employment:'💼', insurance:'🛡️', pension:'👴', business:'🏪',
      daughter:'👧', loan:'💳', savings:'💰', other:'⭐',
    };
    return (
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(options).map(([v, label]) => (
          <button key={v}
            onClick={() => onChange(id, v)}
            className={`flex flex-col items-center justify-center p-5 rounded-2xl border-2 text-center transition-all ${val === v ? 'border-primary bg-primary/10' : 'border-gray-200'}`}
          >
            <span className="text-4xl mb-2">{GOALI[v] || '⭐'}</span>
            <span className="text-sm font-medium text-gray-900 leading-tight">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'urgency_scale') {
    const UCOLS = ['bg-green-100 border-green-400','bg-lime-100 border-lime-400','bg-yellow-100 border-yellow-400','bg-orange-100 border-orange-400','bg-red-100 border-red-400'];
    return (
      <div className="space-y-3">
        {Object.entries(options).map(([v, label], i) => (
          <button key={v}
            onClick={() => onChange(id, v)}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all ${UCOLS[i]} ${val === v ? 'ring-2 ring-primary' : ''}`}
          >
            <span className="text-3xl">{['😌','🙁','😟','😰','🚨'][i]}</span>
            <span className="text-base font-medium text-gray-900">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  if (step.type === 'choice') {
    const DISI: Record<string, string> = {
      visual:'👁️', hearing:'👂', locomotor:'🦽', mental_illness:'🧠',
      intellectual:'📖', multiple:'➕', other:'❓',
    };
    const EDUI: Record<string, string> = {
      primary:'🔢', middle:'📖', matriculation:'📗', higher_secondary:'📘',
      graduate:'🎓', postgraduate:'🏅',
    };
    const icon = (v: string) => {
      if (id === 'disability_type') return DISI[v] || '❓';
      if (id === 'education_level')  return EDUI[v] || '📚';
      return { male:'👨', female:'👩', transgender:'🏳️‍⚧️', prefer_not_to_say:'🔒' }[v] || '•';
    };
    return (
      <div className="space-y-3">
        {Object.entries(options).map(([v, label]) => (
          <button key={v}
            onClick={() => onChange(id, v)}
            className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all ${val === v ? 'border-primary bg-primary/10' : 'border-gray-200'}`}
          >
            <span className="text-3xl">{icon(v)}</span>
            <span className="text-lg font-medium text-gray-900">{label}</span>
          </button>
        ))}
      </div>
    );
  }

  // text / number fallback
  return (
    <input
      type={step.type === 'number' ? 'number' : 'text'}
      className="form-input"
      value={String(val || '')}
      onChange={e => onChange(id, e.target.value)}
      inputMode={step.type === 'number' ? 'numeric' : 'text'}
      placeholder={q(qData, id, 'placeholder', '')}
      autoComplete="off"
    />
  );
}
