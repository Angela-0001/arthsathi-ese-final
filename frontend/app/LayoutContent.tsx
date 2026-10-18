/**
 * ArthSathi — Layout Content (Client Component)
 *
 * Handles conditional navbar rendering based on route
 */

'use client';

import { usePathname } from 'next/navigation';
import Navbar from '../components/ui/Navbar';
import MobileNav from '../components/ui/MobileNav';

export default function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideNav = pathname === '/auth';

  return (
    <>
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
      <div className={hideNav ? '' : 'mb-20 md:mb-0'}>
        {children}
      </div>
    </>
  );
}
