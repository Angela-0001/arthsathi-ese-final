'use client';
/**
 * ArthSathi — Document Safety Checker (Phase 4)
 * Camera → OCR (Tesseract) → Risk analysis → Plain-language summary → TTS → Q&A
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

type ProcessingStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error';

interface RiskFlag {
  risk_type: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  context?: string;
}

interface DocResult {
  id: string;
  summary_text: string;
  risk_flags: RiskFlag[];
  overall_risk: 'low' | 'medium' | 'high' | 'critical';
  ocr_confidence: number;
  llm_model_used: string;
  conversation_history?: { role: string; content: string }[];
  processed_at: string | null;
}

const RISK_COLORS: Record<string, string> = {
  high:     'bg-red-100 border-red-400 text-red-900',
  critical: 'bg-red-200 border-red-600 text-red-900',
  medium:   'bg-amber-100 border-amber-400 text-amber-900',
  low:      'bg-green-100 border-green-400 text-green-900',
};
const RISK_EMOJI: Record<string, string> = { high:'🔴', critical:'🚨', medium:'🟡', low:'🟢' };

export default function DocumentPage() {
  const router = useRouter();
  const fileRef   = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [status,     setStatus]   = useState<ProcessingStatus>('idle');
  const [preview,    setPreview]  = useState<string | null>(null);
  const [docId,      setDocId]    = useState<string | null>(null);
  const [result,     setResult]   = useState<DocResult | null>(null);
  const [error,      setError]    = useState<string | null>(null);
  const [question,   setQuestion] = useState('');
  const [qaHistory,  setQaHist]   = useState<{ role: string; content: string }[]>([]);
  const [askingQ,    setAskingQ]  = useState(false);
  const [lang]                    = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('as_lang') || 'en') : 'en'
  );

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setPreview(URL.createObjectURL(file));
    setStatus('uploading');

    const userId = localStorage.getItem('as_user_id');
    if (!userId) {
      setError('Please complete onboarding first.');
      setStatus('error');
      return;
    }

    const fd = new FormData();
    fd.append('document', file);
    fd.append('user_id', userId);
    fd.append('language', lang);

    try {
      const r = await fetch(`${API}/api/documents/upload`, { method: 'POST', body: fd });
      if (!r.ok) throw new Error('Upload failed');
      const d = await r.json();
      setDocId(d.document_id);
      setStatus('processing');
      poll(d.document_id);
    } catch (e) {
      setError(String(e));
      setStatus('error');
    }
  }, [lang]);

  const poll = async (id: string) => {
    let tries = 0;
    const check = async (): Promise<void> => {
      if (++tries > 40) { setError('Processing timed out. Try a clearer image.'); setStatus('error'); return; }
      const r = await fetch(`${API}/api/documents/${id}`);
      const d = await r.json();
      if (d.data?.processed_at) {
        setResult(d.data);
        setStatus('ready');
        if (d.data.conversation_history) setQaHist(d.data.conversation_history);
      } else {
        await new Promise(res => setTimeout(res, 3000));
        return check();
      }
    };
    await check().catch(() => { setError('Could not get result.'); setStatus('error'); });
  };

  const askQuestion = async () => {
    if (!question.trim() || !docId) return;
    setAskingQ(true);
    try {
      const r = await fetch(`${API}/api/documents/${docId}/question`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      });
      const d = await r.json();
      if (d.success) { setQaHist(d.conversation_history); setQuestion(''); }
      else setError(d.error?.message || 'Could not answer');
    } catch { setError('Network error'); }
    setAskingQ(false);
  };

  const reset = () => {
    setStatus('idle'); setPreview(null); setResult(null);
    setDocId(null); setQaHist([]); setError(null); setQuestion('');
  };

  const riskLevel = result?.overall_risk || 'low';

  return (
    <main className="min-h-screen bg-amber-50 flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <header className="bg-amber-600 text-white px-5 pt-10 pb-5">
        <button onClick={() => router.back()} className="text-white/80 text-sm mb-3 block min-h-[44px]">← Back</button>
        <h1 className="text-2xl font-bold">📄 Document Safety Checker</h1>
        <p className="text-white/80 text-sm mt-1">Photograph any agreement — we'll explain it in plain language</p>
      </header>

      <div className="flex-1 px-4 py-5 space-y-4">

        {/* IDLE */}
        {status === 'idle' && (
          <>
            <button onClick={() => cameraRef.current?.click()}
              className="btn-primary bg-amber-600 hover:bg-amber-700">
              <span className="text-3xl">📷</span> Take a Photo
            </button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment"
              className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

            <button onClick={() => fileRef.current?.click()} className="btn-secondary">
              <span className="text-3xl">📁</span> Upload Image
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp"
              className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

            <div className="bg-white rounded-3xl border border-amber-200 p-4">
              <p className="font-semibold text-gray-800 mb-2">📋 Tips for best results</p>
              <ul className="text-sm text-gray-600 space-y-1">
                <li>• Place document on dark flat surface</li>
                <li>• Good lighting, no shadows or glare</li>
                <li>• Hold phone directly above, all text visible</li>
                <li>• Works with: loan agreements, rental deeds, insurance forms</li>
              </ul>
            </div>
          </>
        )}

        {/* UPLOADING / PROCESSING */}
        {(status === 'uploading' || status === 'processing') && (
          <div className="text-center py-12">
            {preview && <img src={preview} alt="document" className="max-h-40 mx-auto rounded-2xl shadow mb-5 object-contain" />}
            <div className="text-6xl mb-4 voice-recording">{status === 'uploading' ? '📤' : '🔍'}</div>
            <p className="text-xl font-semibold text-gray-800">
              {status === 'uploading' ? 'Uploading...' : 'Reading your document...'}
            </p>
            <p className="text-gray-500 text-sm mt-2">This may take 30–60 seconds</p>
          </div>
        )}

        {/* ERROR */}
        {status === 'error' && (
          <div className="bg-red-50 border-2 border-red-300 rounded-3xl p-5 text-center">
            <p className="text-4xl mb-3">⚠️</p>
            <p className="text-red-800 font-semibold text-lg mb-4">{error}</p>
            <button className="btn-primary" onClick={reset}>Try Again</button>
          </div>
        )}

        {/* READY — Results */}
        {status === 'ready' && result && (
          <>
            {preview && <img src={preview} alt="doc" className="max-h-28 rounded-2xl shadow object-contain mx-auto" />}

            {/* Overall risk badge */}
            <div className={`rounded-3xl border-2 p-4 ${RISK_COLORS[riskLevel]}`}>
              <div className="flex items-center gap-3">
                <span className="text-4xl">{RISK_EMOJI[riskLevel]}</span>
                <div>
                  <p className="font-bold text-xl">
                    {riskLevel === 'high' || riskLevel === 'critical'
                      ? 'HIGH RISK — Read carefully before signing'
                      : riskLevel === 'medium'
                      ? 'SOME RISKS — Check these points'
                      : 'LOW RISK — Looks mostly okay'}
                  </p>
                  {result.ocr_confidence > 0 && (
                    <p className="text-sm opacity-70">OCR confidence: {result.ocr_confidence.toFixed(0)}%
                      {result.llm_model_used && ` | Model: ${result.llm_model_used}`}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-white rounded-3xl border border-gray-200 p-5">
              <h2 className="font-bold text-gray-900 text-xl mb-3">📝 What This Document Says</h2>
              <p className="text-gray-700 text-base whitespace-pre-wrap leading-relaxed">
                {result.summary_text || 'Could not generate summary. Please ensure the image is clear.'}
              </p>
            </div>

            {/* Risk flags */}
            {result.risk_flags && result.risk_flags.length > 0 && (
              <div className="bg-white rounded-3xl border border-red-200 p-5">
                <h2 className="font-bold text-red-800 text-xl mb-3">
                  ⚠️ Caution: Important Points ({result.risk_flags.length})
                </h2>
                <div className="space-y-3">
                  {result.risk_flags.map((f, idx) => (
                    <div key={idx} className={`p-3 rounded-2xl border ${RISK_COLORS[f.severity]}`}>
                      <p className="font-bold text-base capitalize">{RISK_EMOJI[f.severity]} {f.risk_type.replace(/_/g,' ')}</p>
                      <p className="text-sm mt-1">{f.explanation}</p>
                      {f.context && <p className="text-xs mt-1 italic opacity-60 truncate">"{f.context.slice(0,100)}"</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Q&A History */}
            {qaHistory.length > 0 && (
              <div className="bg-white rounded-3xl border border-gray-200 p-5">
                <h2 className="font-bold text-gray-800 text-lg mb-3">💬 Questions & Answers</h2>
                <div className="space-y-2">
                  {qaHistory.map((m, i) => (
                    <div key={i} className={`p-3 rounded-xl text-sm ${m.role === 'user' ? 'bg-primary/10 text-gray-900' : 'bg-gray-100 text-gray-700'}`}>
                      <span className="font-semibold">{m.role === 'user' ? 'You: ' : 'ArthSathi: '}</span>
                      {m.content}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Ask a question */}
            <div className="bg-white rounded-3xl border border-gray-200 p-5">
              <h2 className="font-bold text-gray-800 text-lg mb-3">❓ Ask about this document</h2>
              <p className="text-xs text-gray-500 mb-3">ℹ️ This is not legal advice. For important decisions, consult NALSA/DLSA Legal Aid (helpline: 15100)</p>
              <div className="flex gap-2">
                <input type="text" className="form-input flex-1 text-sm"
                  value={question} onChange={e => setQuestion(e.target.value)}
                  placeholder="What is the interest rate?"
                  onKeyDown={e => e.key === 'Enter' && askQuestion()} />
                <button onClick={askQuestion} disabled={askingQ || !question.trim()}
                  className="btn-primary flex-shrink-0 w-auto px-4 py-3 text-sm">
                  {askingQ ? '...' : 'Ask →'}
                </button>
              </div>
            </div>

            <button className="btn-secondary" onClick={reset}>📷 Check Another Document</button>
          </>
        )}
      </div>
    </main>
  );
}
