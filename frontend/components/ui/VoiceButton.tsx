/**
 * ArthSathi — VoiceButton Component
 *
 * A large, accessible microphone button that:
 * 1. Records audio from the microphone using MediaRecorder API
 * 2. Sends the audio to /api/voice/stt
 * 3. Returns the transcript text via onTranscript callback
 *
 * Used on every input screen when interaction_mode = 'voice'.
 *
 * ACCESSIBILITY
 * - Role="button" with aria-label and aria-pressed
 * - Visual pulse animation while recording
 * - Screen reader announcements via aria-live
 */

'use client';

import { useState, useRef, useCallback } from 'react';
import { getApiUrl } from '@/lib/config';
import { t } from '../../i18n';

interface VoiceButtonProps {
  language?: string;
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const API_URL = getApiUrl();

export default function VoiceButton({
  language = 'hi',
  onTranscript,
  onError,
  size = 'lg',
  className = '',
}: VoiceButtonProps) {
  const [state, setState]           = useState<'idle' | 'recording' | 'processing'>('idle');
  const mediaRecorderRef            = useRef<MediaRecorder | null>(null);
  const audioChunksRef              = useRef<Blob[]>([]);
  const streamRef                   = useRef<MediaStream | null>(null);

  const sizeClasses = {
    sm: 'w-14 h-14 text-2xl',
    md: 'w-20 h-20 text-3xl',
    lg: 'w-24 h-24 text-4xl',
  };

  const startRecording = useCallback(async () => {
    if (state !== 'idle') return;
    setState('recording');
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Choose best available MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg;codecs=opus';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setState('processing');

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        await sendAudio(audioBlob, mimeType);
      };

      recorder.start();
    } catch (err) {
      setState('idle');
      const msg = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Microphone access denied. Please allow microphone access in browser settings.'
        : 'Could not start recording. Please check microphone.';
      onError?.(msg);
    }
  }, [state, language, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, [state]);

  const sendAudio = async (audioBlob: Blob, mimeType: string) => {
    try {
      const ext = mimeType.includes('webm') ? '.webm' : '.ogg';
      const formData = new FormData();
      formData.append('audio', audioBlob, `recording${ext}`);
      formData.append('language', language);

      const res = await fetch(`${API_URL}/api/voice/stt`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (data.text && data.text.trim()) {
        onTranscript(data.text.trim());
      } else {
        onError?.('Could not understand audio. Please speak clearly and try again.');
      }
    } catch (err) {
      // STT service unavailable — browser Web Speech API fallback
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        useBrowserSTT(language, onTranscript, onError);
      } else {
        onError?.('Voice input unavailable. Please type your answer instead.');
      }
    } finally {
      setState('idle');
    }
  };

  const handleClick = () => {
    if (state === 'idle')      startRecording();
    else if (state === 'recording') stopRecording();
  };

  const bgColor = state === 'recording'
    ? 'bg-red-500 hover:bg-red-600'
    : state === 'processing'
    ? 'bg-gray-400 cursor-wait'
    : 'bg-primary hover:bg-primary-light';

  const label = state === 'recording'
    ? t('voice.tap_to_stop')
    : state === 'processing'
    ? t('voice.processing')
    : t('voice.tap_to_speak');

  const emoji = state === 'recording' ? '🔴' : state === 'processing' ? '⏳' : '🎤';

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <button
        onClick={handleClick}
        disabled={state === 'processing'}
        aria-label={label}
        aria-pressed={state === 'recording'}
        className={`
          ${sizeClasses[size]} ${bgColor}
          rounded-full flex items-center justify-center
          text-white shadow-lg transition-all duration-150
          focus-visible:ring-4 focus-visible:ring-accent focus-visible:ring-offset-2
          disabled:opacity-60
          ${state === 'recording' ? 'voice-recording' : ''}
        `}
        role="button"
      >
        <span role="img" aria-hidden="true">{emoji}</span>
      </button>
      <p
        className="text-base text-gray-600 font-medium text-center"
        aria-live="polite"
        aria-atomic="true"
      >
        {label}
      </p>
    </div>
  );
}

/**
 * Browser Web Speech API fallback for when the Whisper backend is unavailable.
 * Works in Chrome/Edge/Safari without any server calls.
 */
function useBrowserSTT(
  language: string,
  onTranscript: (text: string) => void,
  onError?: (msg: string) => void
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.('Speech recognition not available in this browser.');
    return;
  }

  const recognition = new SpeechRecognition();
  const langMap: Record<string, string> = {
    hi: 'hi-IN', mr: 'mr-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', en: 'en-IN',
  };
  recognition.lang = langMap[language] || 'hi-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event: { results: { [key: number]: { [key: number]: { transcript: string } } } }) => {
    const text = event.results[0][0].transcript;
    if (text) onTranscript(text);
  };

  recognition.onerror = () => {
    onError?.('Browser voice recognition failed. Please type your answer.');
  };

  recognition.start();
}
