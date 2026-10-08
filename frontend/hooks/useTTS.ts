/**
 * ArthSathi — useTTS hook
 *
 * Provides text-to-speech for any component.
 * Priority order:
 *   1. Backend TTS API (pyttsx3/Piper) — best quality
 *   2. Browser Web Speech API — works offline, no backend needed
 *
 * Usage:
 *   const { speak, stop, speaking } = useTTS();
 *   speak("नमस्ते", "hi");
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { currentLanguage } from '../i18n';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const synthRef   = useRef<SpeechSynthesisUtterance | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(async (text: string, language?: string) => {
    if (!text || !text.trim()) return;
    const lang = language || currentLanguage();

    stop(); // stop any previous speech
    setSpeaking(true);

    // Try backend TTS first
    try {
      const res = await fetch(`${API_URL}/api/voice/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: lang }),
      });

      if (res.ok && res.headers.get('content-type')?.includes('audio')) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          setSpeaking(false);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          setSpeaking(false);
          browserSpeak(text, lang, setSpeaking);
        };

        await audio.play();
        return;
      }
    } catch {
      // Backend unavailable — fall through to browser TTS
    }

    // Browser Web Speech API fallback
    browserSpeak(text, lang, setSpeaking);
  }, [stop]);

  return { speak, stop, speaking };
}

function browserSpeak(text: string, lang: string, setSpeaking: (v: boolean) => void) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    setSpeaking(false);
    return;
  }

  const langMap: Record<string, string> = {
    hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', en: 'en-IN',
  };

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang  = langMap[lang] || 'hi-IN';
  utterance.rate  = 0.85;  // slightly slower for comprehension
  utterance.pitch = 1.0;

  utterance.onend = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);

  window.speechSynthesis.speak(utterance);
}
