'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navbar from '../components/ui/Navbar';
import MobileNav from '../components/ui/MobileNav';

function LoadingBar({ show }: { show: boolean }) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-[3px] transition-all duration-300"
      style={{
        background: 'linear-gradient(90deg, #16A34A, #22C55E, #16A34A)',
        backgroundSize: '200% 100%',
        animation: show ? 'loading-progress 1s ease-in-out infinite' : 'none',
        opacity: show ? 1 : 0,
        width: show ? '100%' : '0%',
      }}
    />
  );
}

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname === '/auth';
  const [loading, setLoading] = useState(false);
  const [prevPath, setPrevPath] = useState(pathname);

  // Show bar when navigation starts (custom event from useNavigate hook)
  useEffect(() => {
    const handleStart = () => setLoading(true);
    window.addEventListener('navigation-start', handleStart);
    return () => window.removeEventListener('navigation-start', handleStart);
  }, []);

  // Hide bar when new page is rendered
  useEffect(() => {
    if (pathname !== prevPath) {
      setLoading(false);
      setPrevPath(pathname);
    }
  }, [pathname, prevPath]);

  return (
    <>
      <LoadingBar show={loading} />
      {!hideNav && (
        <>
          <div className="hidden md:block">
            <Navbar />
          </div>
          <div className="md:hidden">
            <MobileNav />
          </div>
        </>
      )}
      <div
        key={pathname}
        className={`${hideNav ? '' : 'mb-20 md:mb-0'} page-enter`}
      >
        {children}
      </div>
    </>
  );
}
