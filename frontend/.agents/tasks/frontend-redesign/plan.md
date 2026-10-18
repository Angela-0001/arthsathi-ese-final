# ArthSathi Frontend Redesign Implementation Plan

## Overview
Redesign the ArthSathi Next.js 15 PWA frontend with a professional, mobile-first UI while preserving all backend APIs, i18n functionality, voice features, and offline PWA capabilities.

## Design Decisions

### Color Palette (NEW)
- **Primary**: #F97316 (saffron-orange) - replaces old #1B6B3A green
- **Secondary**: #16A34A (deep green) - for secondary actions
- **Accent**: #0EA5E9 (sky blue) - for highlights and links
- **Surface**: #FAFAFA (off-white) - background
- **Text**: #1F2937 (dark gray) - body text

**Rationale**: User requested saffron-orange primary to replace existing green. Saffron orange is culturally significant in India, energetic, and accessible. Paired with calming green secondary and sky blue accent for balance.

### Component Architecture
Build a reusable component library (Button, Card, Navbar, MobileNav, Modal, Toast, Loader) to replace inline Tailwind classes throughout pages. This ensures consistency and makes future updates easier.

**Rationale**: Current code repeats similar Tailwind class patterns. Extracting to components reduces duplication and makes the new design system enforceable.

### Authentication Flow
Preserve existing POST /api/users endpoint contract. Standardize localStorage key to 'as_user_id' (current code uses both 'as_user_id' and 'arthsathi_user' inconsistently). After auth, redirect to new /dashboard page instead of directly to /onboarding.

**Rationale**: Backend has no real authentication (no password verification), so the existing "login" is actually user lookup/creation. Dashboard gives users a central hub to access all features, improving discoverability.

### Navigation Structure
- **Desktop**: Sticky top navbar with logo, links (Home, Eligibility, Documents, Connect, Call Us), language switcher, Login/Profile menu
- **Mobile**: Hamburger menu + optional bottom tab bar for main actions (Home, Eligibility, Documents, Profile)

**Rationale**: Mobile-first audience needs large tap targets and persistent access to primary actions. Bottom tab bar is standard on mobile apps and reduces thumb reach.

### Page Structure
- **Homepage** (public): Hero, how-it-works, features, connect info, footer
- **Auth** (public): Login/signup forms
- **Dashboard** (NEW, protected): Welcome + 6 action cards
- **Onboarding** (protected): Existing questionnaire, minimal UI updates
- **Results** (protected): Existing results with better card design, tabs for Schemes/Insurance
- **Document** (protected): Existing OCR flow with cleaner UI
- **Connect** (NEW, public): WhatsApp, Telegram, IVR info cards (rename from /channels)
- **IVR** (NEW, public): Dedicated IVR page with tap-to-call

**Rationale**: Dashboard centralizes navigation. Separate /connect and /ivr pages make multi-channel access clearer for low-literacy users.

### Environment Variables
Externalize contact info (IVR number, WhatsApp number, Telegram username) to environment variables with fallbacks to current hardcoded values.

**Rationale**: Makes deployment to different environments easier, supports testing with sandbox numbers.

### Preserved Functionality
- **i18n**: Two systems coexist - i18n/index.ts for UI strings (t() function), lib/i18n.ts for questionnaire JSON from backend
- **localStorage keys**: as_user_id, as_profile, as_lang, as_mode, as_results_v2, as_offline_profile
- **API contracts**: All POST/GET endpoints unchanged
- **Voice features**: Browser SpeechSynthesis TTS, /api/voice/stt endpoint, mic button on questionnaire
- **Offline PWA**: Service worker, manifest.json, checkConnectivity with HTTP ping, localStorage caching
- **Adaptive questionnaire**: Driven by backend i18n/:lang/questions.json, branching logic intact

**Rationale**: These are core features that work correctly. Redesign is UI-only, not a rewrite.

---

## Implementation Plan

### Feature 1: Design System & Component Library

- [ ] 1. **Clear stale Next.js cache to fix 357.js module error**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\.next\ (delete)
      - Verify: Directory removed, no 357.js error on next npm run dev

- [ ] 2. **Update Tailwind config with new color palette**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\tailwind.config.js
      - Change: Replace primary #1B6B3A → #F97316, accent #F5A623 → #0EA5E9, add secondary #16A34A, surface #FAFAFA, textDark #1F2937
      - Verify: npm run dev starts, inspect browser DevTools > Sources > tailwind.config.js shows new colors

- [ ] 3. **Update globals.css with new button styles**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\styles\globals.css
      - Change: .btn-primary uses bg-primary (now #F97316), .btn-secondary uses border-secondary/bg-secondary, add .btn-accent
      - Verify: Existing pages using .btn-primary show orange buttons in browser

- [ ] 4. **Create shared UI components (9 components)**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\components\ui\Button.tsx, Card.tsx, Navbar.tsx, MobileNav.tsx, Modal.tsx, Toast.tsx, Loader.tsx
      - Create: Button with variants (primary, secondary, accent, ghost), sizes (sm, md, lg), loading/disabled states; Card with shadow/border variants; Navbar with logo+links+language switcher; MobileNav with hamburger+slide-in; Modal with backdrop+keyboard handling; Toast with auto-dismiss; Loader with sizes
      - Verify: Each component file exists, npm run dev compiles without TypeScript errors, can import components in test page

---

### Feature 2: Core Pages (Homepage, Auth, Dashboard)

- [ ] 5. **Integrate Navbar and MobileNav in layout**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\layout.tsx
      - Change: Import Navbar and MobileNav, conditionally render (hide on /auth), preserve existing LanguageInitializer, OfflineBanner, PWA metadata, service worker
      - Verify: Navbar appears on homepage, disappears on /auth, hamburger menu works on mobile viewport

- [ ] 6. **Redesign Homepage**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\page.tsx
      - Change: Replace entire page with: hero section (🌱 icon, ArthSathi heading, tagline, CTA button), how-it-works (3 steps in Cards), features (4 Cards with icons), connect section (IVR/WhatsApp/Telegram with env vars), footer. Use Button and Card components, new palette
      - Verify: Open http://localhost:3000, see new homepage with orange CTA button, green/blue accents, language switcher still works

- [ ] 7. **Redesign Auth page**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\auth\page.tsx
      - Change: Use Button and Card components, preserve login/register tabs, phone/email toggle, POST /api/users API call, store as_user_id (fix 'arthsathi_user' inconsistency), redirect to /dashboard after success
      - Verify: Navigate to /auth, complete signup with phone number, verify redirect to /dashboard, check localStorage has 'as_user_id' key

- [ ] 8. **Create Dashboard page**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\dashboard\page.tsx (NEW)
      - Create: Protected route (redirect to /auth if no as_user_id), welcome message, 6 action Cards (Check Eligibility → /onboarding, My Schemes → /results, Document Checker → /document, WhatsApp/Telegram external links, IVR modal), responsive grid
      - Verify: After auth, land on /dashboard, see 6 cards, click 'Check Eligibility' goes to /onboarding, navbar shows, mobile layout stacks cards

- [ ] 9. **Update Onboarding page**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\onboarding\page.tsx
      - Change: Update button styles to use new palette (primary #F97316), ensure 'use client' present, preserve ALL logic (adaptive questions, voice, localStorage, API calls)
      - Verify: From dashboard, go to /onboarding, complete questionnaire, voice button works, submit redirects to /results, no console errors

- [ ] 10. **Create .env.example file**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\.env.example (NEW)
      - Create: Document NEXT_PUBLIC_API_URL, NEXT_PUBLIC_IVR_NUMBER, NEXT_PUBLIC_WHATSAPP_NUMBER, NEXT_PUBLIC_TELEGRAM_USERNAME with example values
      - Verify: File exists with all 4 variables documented

---

### Feature 3: Results, Document, Connect Pages

- [ ] 11. **Redesign Results page with tabs and better cards**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\results\page.tsx
      - Change: Use Card component for scheme/insurance cards, improve card design (larger icons, colored score badges with new palette, benefit amount prominent, explain_text in colored box, tags as pills, collapsible score breakdown), add tabs for Schemes 🌾 vs Insurance 🛡️, preserve ALL logic (checkConnectivity, cache, API calls, event logging)
      - Verify: Complete onboarding, land on /results, see tabs, click tabs to switch, cards show new design with orange/green/blue colors, Apply button works, offline mode works (stop backend, reload, cached results appear)

- [ ] 12. **Redesign Document page**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\document\page.tsx
      - Change: Use Card and Button components, improve upload UI (side-by-side buttons, tips card), improve results UI (better risk badges with new accent color, summary in Card, risk flags as colored alerts, Q&A as chat bubbles), preserve ALL logic (upload, polling, OCR, Q&A)
      - Verify: Navigate to /document, upload test image, see improved UI, risk highlighting uses new colors, Q&A works

- [ ] 13. **Rename and redesign Connect page**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\channels\page.tsx → c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\connect\page.tsx
      - Change: Rename directory from /channels to /connect, use Card component for each channel (IVR, WhatsApp, Telegram), pull contact info from env vars with fallbacks, improve styling
      - Verify: Navigate to /connect (not /channels), see 3 channel cards with new design, IVR copy button works, WhatsApp/Telegram links open

- [ ] 14. **Create IVR page**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\ivr\page.tsx (NEW)
      - Create: Dedicated IVR page with large phone icon, tap-to-call link with env var IVR number, usage instructions (steps 1-4), supported languages list, 24/7 badge. Use Card and Button components
      - Verify: Navigate to /ivr, see IVR number as tap-to-call link, tap on mobile or click on desktop triggers phone call

- [ ] 15. **Update navigation links**
      - Files: c:\Users\angel\Desktop\ArthSathiFinal\frontend\components\ui\Navbar.tsx, c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\dashboard\page.tsx, c:\Users\angel\Desktop\ArthSathiFinal\frontend\app\page.tsx
      - Change: Update all /channels links to /connect, ensure navbar links to Connect and Call Us (/connect and /ivr), dashboard cards link correctly
      - Verify: Click navbar 'Connect' goes to /connect, 'Call Us' goes to /ivr, no broken links

---

### Feature 4: Integration Testing & Polish

- [ ] 16. **Test complete user journey**
      - Test: Homepage → language switch → auth → dashboard → onboarding → results → document → connect → ivr
      - Verify: All steps complete without errors, UI renders correctly at each step, data persists in localStorage, API calls succeed

- [ ] 17. **Mobile responsiveness testing**
      - Test: Chrome DevTools device emulation on iPhone SE (375px), iPhone 12 Pro (390px), Pixel 5 (393px), iPad (768px)
      - Verify: All pages render correctly, no horizontal scroll, touch targets min 48px, hamburger menu works, modals center, forms fit viewport

- [ ] 18. **Accessibility audit**
      - Test: (1) Verify all buttons/links/inputs min-h-[48px], (2) Tab navigation through all pages, (3) Check color contrast (WebAIM tool for #F97316, #16A34A, #0EA5E9 on white/surface), (4) Verify alt text and aria-labels
      - Verify: All interactive elements meet WCAG 2.5.5 target size, keyboard nav works, contrast ratios ≥ 4.5:1, semantic HTML present

- [ ] 19. **Offline PWA testing**
      - Test: Load app, complete onboarding, stop backend, reload app, check offline banner and cached results, restart backend, verify reconnect
      - Verify: Offline banner appears when backend down, cached results load, service worker registered (DevTools > Application > Service Workers)

- [ ] 20. **Cross-page navigation testing**
      - Test: Click all navbar links, dashboard cards, back buttons, browser back/forward
      - Verify: All links work, no 404s, browser navigation works with Next.js App Router

- [ ] 21. **Performance check**
      - Test: Run Lighthouse audit on /, /dashboard, /results. Check Network tab on Fast 3G throttling
      - Verify: Performance > 70, Accessibility > 90, Best Practices > 80, first load < 3s on Fast 3G

- [ ] 22. **Final code review and build**
      - Test: (1) Check browser console for errors across all pages, (2) Run npm run build, (3) Verify .env.example, (4) Check localStorage keys use 'as_' prefix, (5) Grep for TODO/FIXME
      - Verify: No console errors, build completes successfully, env vars documented, localStorage consistent, no unresolved TODOs

- [ ] 23. **Fix bugs found in testing**
      - Fix: Address any issues from steps 16-22 (broken links, styling issues, accessibility violations, performance bottlenecks)
      - Verify: Re-test affected areas, confirm fixes work

---

## Summary

**Total Steps**: 23 steps across 4 features
**Estimated Effort**: Medium-large (full frontend redesign)
**Risk Areas**: 
- Stale .next cache (fixed in step 1)
- localStorage key inconsistency (fixed in step 7)
- Two i18n systems (preserved, documented in context)
- Three-process architecture dependency (all testing requires backend and ML engine running)

**Key Preservations**:
- All API endpoints unchanged
- All localStorage keys preserved (standardized to 'as_' prefix)
- i18n system unchanged (both i18n/index.ts and lib/i18n.ts kept)
- Voice features unchanged (TTS, STT, mic button)
- Offline PWA unchanged (service worker, manifest, caching)
- Adaptive questionnaire logic unchanged

**Delivery**:
- New color palette (saffron-orange primary #F97316, green secondary #16A34A, blue accent #0EA5E9)
- Component library (Button, Card, Navbar, MobileNav, Modal, Toast, Loader)
- Redesigned pages (Homepage, Auth, Dashboard, Results, Document, Connect, IVR)
- Mobile-first responsive design
- WCAG 2.5.5 accessibility (48px touch targets)
- Environment variables for contact info (.env.example)
- Cleared .next cache to fix module error

