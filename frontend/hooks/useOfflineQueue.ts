/**
 * ArthSathi — Offline Request Queue
 *
 * When the backend is unreachable, write operations (POST/PUT) are queued
 * in localStorage. When connectivity returns, this hook auto-retries them.
 *
 * Usage:
 *   const { isOnline, queuedCount, enqueue } = useOfflineQueue();
 *   enqueue({ url, method, body });  // queues if offline, sends if online
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface QueuedRequest {
  id:        string;
  url:       string;
  method:    string;
  body:      string;
  headers:   Record<string, string>;
  queuedAt:  number;
  retries:   number;
}

const QUEUE_KEY = 'arthsathi_offline_queue';

function loadQueue(): QueuedRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedRequest[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline]     = useState(true);
  const [queuedCount, setQueuedCount] = useState(0);
  const retryingRef = useRef(false);

  // Sync queue count from localStorage
  const refreshCount = useCallback(() => {
    setQueuedCount(loadQueue().length);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline  = () => { setIsOnline(true);  retryQueue(); };
    const handleOffline = () => { setIsOnline(false); };

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOnline(navigator.onLine);
    refreshCount();

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Retry all queued requests now that we're online.
   * Removes successfully-retried items from the queue.
   */
  const retryQueue = useCallback(async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;

    const queue = loadQueue();
    if (queue.length === 0) { retryingRef.current = false; return; }

    const remaining: QueuedRequest[] = [];

    for (const item of queue) {
      try {
        const res = await fetch(item.url, {
          method:  item.method,
          headers: item.headers,
          body:    item.body || undefined,
        });
        if (!res.ok && res.status >= 500) {
          remaining.push({ ...item, retries: item.retries + 1 });
        }
        // 4xx = permanent failure, discard silently
      } catch {
        // Still offline or server error — keep in queue
        if (item.retries < 10) {
          remaining.push({ ...item, retries: item.retries + 1 });
        }
      }
    }

    saveQueue(remaining);
    setQueuedCount(remaining.length);
    retryingRef.current = false;
  }, []);

  /**
   * Enqueue a request. If online, sends it immediately.
   * If offline, stores in localStorage for later retry.
   */
  const enqueue = useCallback(async (opts: {
    url: string;
    method?: string;
    body?: object;
    headers?: Record<string, string>;
  }) => {
    const method  = opts.method || 'POST';
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const body    = opts.body ? JSON.stringify(opts.body) : '';

    if (navigator.onLine) {
      try {
        const res = await fetch(opts.url, { method, headers, body });
        return res;
      } catch {
        // Server down — fall through to queue
      }
    }

    // Queue it
    const queued: QueuedRequest = {
      id:       `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      url:      opts.url,
      method,
      body,
      headers,
      queuedAt: Date.now(),
      retries:  0,
    };

    const q = loadQueue();
    q.push(queued);
    saveQueue(q);
    setQueuedCount(q.length);

    return null; // indicates queued, not sent
  }, []);

  return { isOnline, queuedCount, enqueue, retryQueue };
}
