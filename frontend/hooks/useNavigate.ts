'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

/**
 * Drop-in replacement for router.push that shows instant loading state.
 * Usage:
 *   const { navigate, navigating } = useNavigate();
 *   <button onClick={() => navigate('/results')} disabled={navigating}>Go</button>
 */
export function useNavigate() {
  const router = useRouter();
  const [navigating, setNavigating] = useState(false);

  const navigate = useCallback((href: string) => {
    setNavigating(true);
    // Dispatch custom event so LayoutContent can show loading bar
    window.dispatchEvent(new CustomEvent('navigation-start'));
    router.push(href);
    // Reset after 2s in case page doesn't change (already on that page)
    setTimeout(() => setNavigating(false), 2000);
  }, [router]);

  return { navigate, navigating };
}
