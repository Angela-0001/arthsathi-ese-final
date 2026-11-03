# Implementation Plan: ArthSathi Critical Fixes

## Overview

This plan addresses six critical issues: authentication/API connectivity, broken document analysis, profile-ignorant recommendations across all platforms, incomplete multilingual support, missing financial roadmap feature, and excessive hardcoding. Tasks follow a dependency chain: foundation first, then core features, then integration, then testing.

## Tasks

- [x] 1. Fix Frontend API URL Configuration
  - [x] 1.1 Create frontend/lib/config.ts with ConfigManager singleton: detects localhost (->http://localhost:3001), LAN IP (->http://hostname:3001), production (->NEXT_PUBLIC_API_URL), SSR (->localhost:3001). Validates URL, caches for session, throws ConfigurationError if invalid.
  - [x] 1.2 Update frontend/.env.local to set NEXT_PUBLIC_API_URL=http://localhost:3001
  - [x] 1.3 Search all frontend files for hardcoded "192.168.45.161" or direct NEXT_PUBLIC_API_URL usage, replace with ConfigManager.getInstance().getApiUrl()
  - [x] 1.4 Verify auth, results, document, and onboarding pages all use ConfigManager for API calls
  - [x] 1.5 Test frontend connects to backend without ERR_CONNECTION_TIMED_OUT

- [x] 2. Create Centralized Profile Service (Backend)
  - [x] 2.1 Create backend/src/services/profileService.js with fetchUserProfile(userId): query users table, 5-min cache via Map, ProfileNotFoundError for missing users
  - [x] 2.2 Add updateProfile(userId, updates): updates DB and invalidates cache
  - [x] 2.3 Add isProfileComplete(profile): checks mandatory fields (age, gender, state, occupation, monthly_income, caste_category, goals), returns { isValid, missingFields }
  - [x] 2.4 Add validateProfile(profile): validates age 0-120, income non-negative, caste in [general, obc, sc, st, nt, vjnt], language in [en, hi, mr], valid Indian state
  - [x] 2.5 Write unit test: fetchUserProfile returns correct data for user 1, error for invalid ID, cache hit/miss works

- [ ] 3. Fix Recommendation Engine to Use Profile Service
  - [x] 3.1 Update groqRecommendation.js to use ProfileService.fetchUserProfile instead of direct DB query
  - [x] 3.2 Update schemes.js POST /recommend: require user_id, fetch profile via ProfileService, return 400 with missing fields if incomplete, log requests
  - [x] 3.3 Update insurance recommend endpoint similarly
  - [ ] 3.4 Verify fallback chain (Groq to ML Engine to DB filtering) all use profile data
  - [ ] 3.5 Test with two different profiles (disabled female SC vs able-bodied male general), verify different schemes returned

- [ ] 4. Fix Frontend Recommendations to Use Real User ID
  - [ ] 4.1 Review auth/page.tsx to understand how user ID is stored after login (localStorage, cookie, context)
  - [ ] 4.2 Update results/page.tsx: get user_id from session (not hardcoded 1), call recommend endpoints with real user_id, add loading spinner and error retry
  - [ ] 4.3 Update onboarding/page.tsx to save to correct logged-in user ID
  - [ ] 4.4 Remove ALL hardcoded user_id: 1, userId: 1, id: 1 references across frontend
  - [ ] 4.5 Test: login, complete onboarding, view results, schemes match that user profile

- [ ] 5. Fix Document Analysis Pipeline
  - [ ] 5.1 Review backend/src/routes/documents.js and ocrService.js
  - [ ] 5.2 Fix backend: validate file type (jpeg/png/webp/pdf) and size (10MB max), ensure Tesseract from env, add confidence check (60 min), add risk patterns, Groq summary, store in DB
  - [ ] 5.3 Fix frontend document/page.tsx: use ConfigManager, handle 400/500 errors, display results (summary, risk flags, risk level), add loading state, compress images to 2MB
  - [ ] 5.4 Test: upload clear document then get summary and risk flags; upload blurry then get clear error

- [ ] 6. Fix Telegram Bot to Use Profile-Based Recommendations
  - [ ] 6.1 Review bot/src/telegram.js and backend/src/routes/telegram.js
  - [ ] 6.2 Implement telegram_user_id to application user_id mapping (create table if needed, store mapping on first interaction)
  - [ ] 6.3 Update scheme/insurance handlers to look up real user_id and call recommend endpoint (remove hardcoded IDs)
  - [ ] 6.4 Add bot commands: /start, /schemes, /insurance, /profile, /roadmap, /language
  - [ ] 6.5 Add /language command to switch language (en/hi/mr), store in user profile
  - [ ] 6.6 Format recommendations as Telegram messages with inline buttons
  - [ ] 6.7 Test: different Telegram users get different scheme recommendations

- [ ] 7. Fix WhatsApp Bot to Use Profile-Based Recommendations
  - [ ] 7.1 Review bot/src/whatsapp.js and backend/src/routes/whatsapp.js
  - [ ] 7.2 Implement whatsapp_user_id to application user_id mapping (store on first interaction)
  - [ ] 7.3 Update scheme/insurance handlers to use real user_id (remove hardcoded IDs)
  - [ ] 7.4 Add financial roadmap option to WhatsApp menu
  - [ ] 7.5 Add language detection from first message, store in user profile
  - [ ] 7.6 Format as WhatsApp interactive list messages
  - [ ] 7.7 Test: WhatsApp users get profile-based recommendations

- [ ] 8. Complete Multilingual Translation Coverage
  - [ ] 8.1 Audit all frontend pages for hardcoded English strings
  - [ ] 8.2 Update en.json, hi.json, mr.json with all missing keys, organized into namespaces (common, schemes, insurance, dashboard, errors, roadmap, documents)
  - [ ] 8.3 Fix language switching: update all visible text without full page reload, persist in localStorage, add smooth navbar transition
  - [ ] 8.4 Verify Navbar, results, document, onboarding, auth all fully translate
  - [ ] 8.5 Test: switch to Hindi then all Hindi; switch to Marathi then all Marathi; no English remnants

- [ ] 9. Create Financial Roadmap Backend Service
  - [ ] 9.1 Create backend/src/services/roadmapService.js with generate(userId): fetch profile (400 if no income), calculate financial state, parse goals, get eligible schemes/insurance, generate actions by timeframe, build timeline
  - [ ] 9.2 Create backend/src/routes/roadmap.js with GET /api/roadmap/:userId
  - [ ] 9.3 Wire roadmap route into app.js
  - [ ] 9.4 Test: GET /api/roadmap/1 returns structured roadmap with actions and timeline

- [ ] 10. Create Financial Roadmap Frontend Page
  - [ ] 10.1 Create frontend/app/roadmap/page.tsx: fetch user_id, call GET /api/roadmap/:userId, display snapshot card, action sections (immediate/short/long), timeline, loading/empty states, green theme
  - [ ] 10.2 Add Financial Roadmap to Navbar with smooth navigation, add translation keys
  - [ ] 10.3 Add roadmap translations to i18n files in roadmap namespace (en/hi/mr)
  - [ ] 10.4 Test: navigate to /roadmap then see personalized financial plan

- [ ] 11. Remove Hardcoded Values and Externalize Configuration
  - [ ] 11.1 Audit backend for hardcoded API keys, user IDs, URLs, ports, bot tokens
  - [ ] 11.2 Move all found values to backend/.env with sensible defaults
  - [ ] 11.3 Add startup validation in app.js: check critical env vars, fail fast with clear message if missing
  - [ ] 11.4 Audit frontend for hardcoded API URLs, phone numbers, bot usernames
  - [ ] 11.5 Add rate limiting env vars (RATE_LIMIT_PER_HOUR=100, BOT_RATE_LIMIT_PER_MIN=10)
  - [ ] 11.6 Test: app starts normally with correct env; fails clearly if critical var removed

- [ ] 12. Add Error Handling and Health Checks
  - [ ] 12.1 Improve /health endpoint: check DB, Groq, ML engine status, return degraded state
  - [ ] 12.2 Add global error handler middleware in app.js: catch unhandled errors, log stack traces, sanitize for production
  - [ ] 12.3 Frontend: add error boundary per page, retry button on timeout (30s), offline indicator, cached data fallback
  - [ ] 12.4 Backend: exponential backoff retry for DB failures (3 attempts: 1s, 2s, 4s)
  - [ ] 12.5 Test: kill backend then offline indicator; restart then recovers

- [ ] 13. End-to-End Testing and Verification
  - [ ] 13.1 Test web flow: Register then Onboarding then Login then View personalized schemes
  - [ ] 13.2 Test document flow: clear upload then analysis then risk flags; blurry then error
  - [ ] 13.3 Test Telegram: /schemes then profile-based; /roadmap then plan; /language then switch
  - [ ] 13.4 Test WhatsApp: schemes then profile-based; roadmap then plan
  - [ ] 13.5 Test financial roadmap: /roadmap then personalized plan with actions and timeline
  - [ ] 13.6 Test language switching: en then hi (all text) then mr (all text) then en
  - [ ] 13.7 Test profile filtering: two users with different profiles (disabled/able, male/female, SC/general) get DIFFERENT recommendations on web, Telegram, WhatsApp
  - [ ] 13.8 Fix any bugs found during testing
  - [ ] 13.9 Verify no hardcoded user IDs remain in codebase

## Task Dependency Graph

```json
{
  "waves": [
    {
      "tasks": [
        1,
        2
      ],
      "description": "Foundation: API config and profile service"
    },
    {
      "tasks": [
        3
      ],
      "description": "Recommendation engine using profile service"
    },
    {
      "tasks": [
        4,
        5,
        6,
        7,
        8,
        9
      ],
      "description": "Core features: frontend, documents, bots, translations, roadmap backend"
    },
    {
      "tasks": [
        10,
        11,
        12
      ],
      "description": "Roadmap frontend, config cleanup, error handling"
    },
    {
      "tasks": [
        13
      ],
      "description": "End-to-end testing and verification"
    }
  ]
}
```

```text``
Task 1 (API URL Config) ---+-> Task 4 (Frontend Recommendations)
                          +-> Task 5 (Document Analysis)
                          +-> Task 8 (Multilingual)

Task 2 (Profile Service) ---> Task 3 (Recommendation Engine)

Task 3 (Recommendation Engine) ---+-> Task 4 (Frontend Recommendations)
                                  +-> Task 6 (Telegram Bot)
                                  +-> Task 7 (WhatsApp Bot)
                                  +-> Task 9 (Roadmap Backend)
                                  +-> Task 11 (Config Cleanup)

Task 4 (Frontend Recommendations) ---+
Task 5 (Document Analysis) ----------+
Task 6 (Telegram Bot) ---------------+
Task 7 (WhatsApp Bot) ---------------+
Task 8 (Multilingual) -----+-> Task 10 (Roadmap Frontend)
Task 9 (Roadmap Backend) --+

Task 10 (Roadmap Frontend) ---+
Task 11 (Config Cleanup) -----+
Task 12 (Error Handling) -----+-> Task 13 (E2E Testing)
```

## Notes

- Tasks 1 and 2 are foundation tasks with no dependencies, can start immediately in parallel
- Task 3 depends on Task 2 (Profile Service must exist before recommendation engine uses it)
- Tasks 4-9 depend on Tasks 1-3 (need config + profile service + recommendation engine)
- Task 10 depends on Tasks 8 and 9 (need translations + roadmap backend)
- Task 13 depends on all implementation tasks
- Maximum parallelism: Tasks 1, 2 can run together; then Task 3; then Tasks 4-9 in parallel; then 10-12; then 13