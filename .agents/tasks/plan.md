# Implementation Plan: Frontend & Backend Fixes

Based on comprehensive codebase exploration, this plan addresses all identified issues with the ArthSathi frontend and backend, excluding IVR components as requested.

## Issues Identified

1. **Document page theme mismatch**: Uses amber/orange theme (`bg-amber-600`, `bg-amber-50`) instead of the green primary theme (`#1B6B3A`)
2. **Document page vertical layout**: Elements stack vertically without responsive grid layout, poor spacing on wide screens
3. **Layout header visibility**: The sticky header from `layout.tsx` appears on ALL pages including landing and auth, which have their own full-screen gradient headers, causing visual clutter
4. **Missing i18n file**: `app/page.tsx` imports from `'../i18n'` but that file doesn't exist—should import from `'@/i18n'`
5. **LanguageSwitcher implementation**: Forces full page reload (`window.location.reload()`) which breaks SPA behavior and loses state
6. **Results page "no results" bug**: The API routes fall back to cached data when the Python engine is down, but if the engine returns empty arrays OR the user has no profile, the empty state shows incorrectly
7. **Onboarding questionnaire layout**: Generally well-designed but could benefit from better touch target spacing on smaller screens

## Design Decisions

### 1. Layout Header Strategy
**Decision**: Hide the global header on landing and auth pages only. These pages have their own complete header with branding and language selector.

**Rationale**: The landing page (`app/page.tsx`) and auth page (`app/auth/page.tsx`) both have full-screen gradient backgrounds with their own headers. Adding the white sticky header from `layout.tsx` on top creates visual redundancy and breaks the intended design. All other pages (onboarding, results, document) should keep the global header for consistent navigation.

**Implementation**: Add pathname detection in `layout.tsx` to conditionally render the header.

### 2. Document Page Theme
**Decision**: Replace all amber colors with the primary green theme to match the rest of the application.

**Rationale**: The document page currently uses `bg-amber-600` for the header and `bg-amber-50` for background, while the rest of the app uses green (`#1B6B3A`). This creates visual inconsistency. The amber accent color (`#F5A623`) should be reserved for highlights and warnings, not primary UI elements.

**Color mapping**:
- Header: `bg-amber-600` → `bg-primary` (`#1B6B3A`)
- Background: `bg-amber-50` → `bg-gray-50` or `bg-surface`
- Buttons: `bg-amber-600 hover:bg-amber-700` → `bg-primary hover:bg-primary-dark`
- Borders: `border-amber-200` → `border-gray-200` or `border-primary/20`

### 3. Document Page Layout
**Decision**: Implement responsive 2-column grid layout for desktop, single column for mobile, with proper card spacing.

**Rationale**: Current layout stacks all elements vertically even on wide screens. Better approach: 
- Mobile (<768px): single column, current behavior
- Desktop (≥768px): 2-column grid where appropriate (e.g., summary + risk flags side-by-side)
- Use CSS Grid with `grid-cols-1 md:grid-cols-2` pattern
- Increase spacing between sections from `space-y-4` to `space-y-6`
- Ensure the document preview image and overall risk badge remain full-width on all screens for visibility

### 4. I18n Import Fix
**Decision**: Change `app/page.tsx` to import from `'@/i18n'` instead of `'../i18n'`.

**Rationale**: The tsconfig.json defines path aliases including `"@/i18n": ["./i18n/index.ts"]`. The components (LanguageSwitcher, LanguageInitializer) already use `@/i18n` correctly. The landing page's relative import `'../i18n'` fails because there's no `frontend/i18n.ts`—only `frontend/i18n/index.ts`. Using the alias is the correct, consistent approach.

### 5. LanguageSwitcher State Management
**Decision**: Remove `window.location.reload()` and use Next.js router refresh with event bus for cross-component updates.

**Rationale**: Full page reload is heavy-handed and breaks user state. Better approach:
1. Update localStorage
2. Call Next.js `router.refresh()` to trigger server component re-render
3. Emit custom event `languageChanged` that client components can listen to
4. Update `document.documentElement.lang` attribute immediately

This preserves SPA behavior while updating all i18n-dependent components.

### 6. Results Page Empty State Logic
**Decision**: Improve empty state detection to differentiate between "loading", "no matches found", "profile incomplete", and "offline".

**Rationale**: Current implementation shows "No results found" for multiple distinct states:
- User has no profile → redirect to onboarding (already handled but may fail silently)
- Engine returned empty arrays → legitimate "no matches"
- Engine is down + no cache → show offline message with retry
- Network error → show offline banner

**Fix**: Add explicit checks in `loadResults()`:
1. If no `userId`, redirect immediately—don't attempt API calls
2. After API success, check if BOTH `schemes.length === 0 AND insurance.length === 0`—if so, suggest profile update
3. If API fails AND no cache, show specific "Cannot connect" message with retry
4. If cache exists, show offline banner with cache age

### 7. Onboarding Touch Targets
**Decision**: Maintain current `min-h-[48px]` for all interactive elements; increase vertical spacing between question sections.

**Rationale**: Current implementation already follows WCAG 2.5.5 guidelines (48px minimum touch targets). The only improvement needed is visual breathing room: change section spacing from `space-y-4` (16px) to `space-y-5` (20px) for better readability on small screens.

---

## Implementation Steps

- [ ] 1. **Fix layout.tsx header visibility**
      Files: `frontend/app/layout.tsx`
      Add `usePathname()` hook and conditional rendering: hide header when `pathname === '/' || pathname === '/auth'`.
      Verify: Navigate to landing page and auth page—header should not appear. Navigate to /onboarding, /results, /document—header should appear.

- [ ] 2. **Fix app/page.tsx i18n import**
      Files: `frontend/app/page.tsx`
      Change line 15 from `import { t, initLanguage, currentLanguage, LANGUAGES, type LanguageCode } from '../i18n';` to `import { t, initLanguage, currentLanguage, LANGUAGES, type LanguageCode } from '@/i18n';`
      Also change line 77 from `import('../i18n').then(...)` to `import('@/i18n').then(...)`
      Verify: Run `npm run build` in frontend directory—should compile without errors.

- [ ] 3. **Improve LanguageSwitcher.tsx to remove page reload**
      Files: `frontend/components/LanguageSwitcher.tsx`
      Replace `window.location.reload()` with:
      ```tsx
      import { useRouter } from 'next/navigation';
      const router = useRouter();
      // In handleChange:
      setLanguage(newLang);
      router.refresh();
      window.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: newLang } }));
      ```
      Update components that use `t()` to listen for `languageChanged` event and re-render.
      Verify: Switch language in header—page should not reload, but all translated text should update.

- [ ] 4. **Update document/page.tsx theme from amber to green**
      Files: `frontend/app/document/page.tsx`
      Find and replace:
      - `bg-amber-600` → `bg-primary`
      - `hover:bg-amber-700` → `hover:bg-primary-dark`
      - `bg-amber-50` → `bg-gray-50`
      - `border-amber-200` → `border-gray-200`
      - Keep risk-level colors (red, yellow, green for high/medium/low) as-is—these are semantic.
      Verify: Visit `/document` page—header should be green (#1B6B3A), background should be light gray, maintaining readability.

- [ ] 5. **Redesign document/page.tsx layout for responsive grid**
      Files: `frontend/app/document/page.tsx`
      Modifications in the "READY — Results" section (line ~145):
      - Change main container spacing from `space-y-4` to `space-y-6`
      - Wrap summary + risk flags in a `<div className="grid grid-cols-1 md:grid-cols-2 gap-6">` container
      - Keep document preview image, overall risk badge, and Q&A sections full-width (outside grid)
      - Ensure mobile (<768px) remains single-column
      Verify: Open `/document` with a test document on desktop (≥768px wide)—summary and risk flags should appear side-by-side. Test on mobile—should stack vertically.

- [ ] 6. **Enhance results/page.tsx empty state logic**
      Files: `frontend/app/results/page.tsx`
      In `loadResults()` function (line ~85):
      - After checking `userId`, explicitly redirect if missing: `if (!userId) { router.push('/onboarding'); return; }`
      - After API success, check if both arrays empty: `if (s.length === 0 && i.length === 0)` → set a new state flag `hasNoMatches`
      - In `EmptyState` component, accept a `reason` prop: `'no-matches' | 'offline' | 'error'`
      - Display different messages based on reason:
        - `no-matches`: "No matches found. Update your profile for better results."
        - `offline`: "Cannot connect to server. Check your connection and try again."
        - `error`: "Something went wrong. Please try again."
      Verify: Complete onboarding with valid data → results should show schemes/insurance. Test with network disconnected → should show offline message with retry.

- [ ] 7. **Increase onboarding page section spacing**
      Files: `frontend/app/onboarding/page.tsx`
      In the main flex container (line ~350), change `space-y-4` to `space-y-5` for question sections.
      Verify: Open `/onboarding` on a small screen (e.g., iPhone SE)—questions should have more breathing room, easier to read and tap.

- [ ] 8. **Backend: Add logging for empty recommendation responses**
      Files: `backend/src/routes/schemes.js`
      In `POST /api/schemes/recommend` and `POST /api/insurance/recommend`:
      - After receiving `result` from engine, log if arrays are empty: `if (!result.schemes || result.schemes.length === 0) console.log('[Schemes] Engine returned empty schemes array for user', user_id);`
      - This helps diagnose whether the Python engine is returning empty results vs. the backend failing to call it.
      Verify: Tail backend logs (`node server.js`) and trigger a recommendation request—log should appear if engine returns empty data.

- [ ] 9. **Backend: Verify engineService fallback behavior**
      Files: `backend/src/services/engineService.js`, `backend/src/routes/schemes.js`
      Review the fallback logic in `POST /api/schemes/recommend` (line ~88):
      - Ensure that when `isEngineHealthy()` returns false, the cached query actually returns data if cache exists
      - Add error handling if cache query fails: return `{ success: false, error: { code: 'NO_DATA', message: 'No cached recommendations available' } }`
      Verify: Stop the Python engine (`ml-model/recommendation_engine.py`), make a recommendation request—should return cached data with `"source": "cache"`. If no cache, should return error message (not empty array).

- [ ] 10. **Frontend: Update globals.css for consistent card spacing**
      Files: `frontend/styles/globals.css`
      Update `.result-card` class to include `mb-5` (20px bottom margin) instead of `mb-4` (16px), improving visual separation on results page.
      Verify: View `/results` page with multiple scheme cards—spacing between cards should feel more comfortable.

---

## Verification Commands

All verification is visual and functional testing—no automated tests exist in this project.

**Frontend verification**:
```bash
cd frontend
npm run build
npm run dev
```
Then manually test each page in browser at http://localhost:3000.

**Backend verification**:
```bash
cd backend
node server.js
```
Check terminal logs for recommendation requests and fallback behavior.

**Full-stack integration test**:
1. Start Python engine: `cd ml-model && python recommendation_engine.py`
2. Start backend: `cd backend && node server.js`
3. Start frontend: `cd frontend && npm run dev`
4. Complete full user flow: landing → auth → onboarding → results → document checker
5. Test language switching on each page
6. Test offline behavior by disconnecting network

---

## Notes

- The IVR system (`backend/src/routes/ivr.js`, Twilio integration) is excluded from this plan as requested.
- The Python recommendation engine (`ml-model/recommendation_engine.py`) is assumed to be working correctly—this plan only fixes the frontend/backend issues.
- The database schema and seed data are assumed to be correctly populated.
- All color values reference the Tailwind config (`frontend/tailwind.config.js`): primary = `#1B6B3A`, accent = `#F5A623`.

