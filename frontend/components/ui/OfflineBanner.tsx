/**
 * ArthSathi — Offline Status Banner
 *
 * Shows a visible notice when the device is offline.
 * Auto-hides when connectivity returns.
 */

'use client';

import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { t } from '../../i18n';

export default function OfflineBanner() {
  const { isOnline, queuedCount } = useOfflineQueue();

  if (isOnline && queuedCount === 0) return null;

  if (!isOnline) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="fixed top-0 left-0 right-0 z-50 bg-amber-500 text-white px-4 py-3 text-center text-base font-semibold flex items-center justify-center gap-2"
      >
        <span aria-hidden="true">📵</span>
        {t('error.network')}
      </div>
    );
  }

  if (queuedCount > 0) {
    return (
      <div
        role="status"
        className="fixed top-0 left-0 right-0 z-50 bg-green-600 text-white px-4 py-2 text-center text-sm font-medium flex items-center justify-center gap-2"
      >
        <span aria-hidden="true">🔄</span>
        Online — syncing {queuedCount} queued {queuedCount === 1 ? 'action' : 'actions'}...
      </div>
    );
  }

  return null;
}
