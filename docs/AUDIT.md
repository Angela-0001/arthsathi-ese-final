# ArthSathi — Code Audit Report
**Date:** 2026-10-07  
**Auditor:** Rebuild process  
**Verdict:** Major defects. Below prototype quality. Rebuild required for all critical paths.

---

## 1. Scraper (`scraper/scraper.py`)

### Finding: NOT real scraping — all hardcoded stubs
- The file claims to scrape myscheme.gov.in but the `scrape_myscheme_sitemap()` function tries `https://www.myscheme.gov.in/sitemap.xml` via plain HTTP, which returns no scheme data because the site is a JavaScript SPA. The BeautifulSoup parse of the XML sitemap got 0 URLs.
- All 6 schemes in the DB are **hardcoded static records** in individual functions like `scrape_pmkisan()`, `scrape_mgnregs()`, etc. — not scraped data.
- No real API discovery was done. No Playwright usage. No JSON API used.
- `scrape_myscheme_sitemap()` found 0 URLs in every test run.
- **DB has 6 schemes total** — none from myscheme.gov.in. The site claims thousands.

### Action: Complete rewrite using myscheme.gov.in's internal JSON API.

---

## 2. Recommendation Engine (`backend/src/services/recommendationService.js`, `ml-model/engine.py`)

### Finding: Functional but incomplete and wrong schema
- The 5-component scoring works and produces reasonable outputs.
- BUT: the schema required (8 features, MMR re-ranking, per-user weight adaptation, 3-valued eligibility, `UNKNOWN` handling, category_affinity) is not implemented.
- Only `PASS`/`FAIL` logic — no `UNKNOWN` (missing field) state.
- No MMR diversity re-ranking.
- No `user_weight_profiles` table or per-user weight storage.
- Adaptive learning is stubbed — the gradient update runs but weights are never actually read back at serve time (the engine loads `weights.json` but there's no mechanism to write it per-user).
- The `explain()` function doesn't exist.

### Action: Full rewrite of engine with all 8 features, 3-valued logic, MMR, per-user weights, and explain().

---

## 3. Onboarding (`frontend/app/onboarding/page.tsx`)

### Finding: Fixed questions, wrong ration card, not language-driven
- All questions are hardcoded as TypeScript objects in the page file — not data-driven.
- Ration card page shows wrong options: `AAY`, `BPL`, `APL`, `none` with confusing labels.
- No branching/adaptive logic beyond a basic `show: (p) => p.occupation === 'farmer'` for land.
- Language is set at step 1 but subsequent questions render in English (the `t()` function falls back to English keys because the question text objects use English keys directly).
- No `depends_on` or information-gain selection.
- Questions are defined in code, not in `i18n/questions.json`.

### Action: Move all questions to `i18n/questions.json`. Implement proper branching. Fix ration card page.

---

## 4. Results / Recommendations Page (`frontend/app/results/page.tsx`)

### Finding: "No internet connection" bug — uses wrong offline detection
- The page uses a URL param `?offline=1` as the offline signal, which is never set correctly.
- When the backend IS reachable, `loadResults()` throws because `userId` from localStorage is null for new sessions (the onboarding creates a user but `arthsathi_user_id` may not be set).
- Error handling catches the fetch error and calls `t('error.network')` which renders "No internet connection" even when the server is up.
- No real connectivity check — uses only URL params, not a health-check request.
- No IndexedDB — only localStorage for caching (unreliable for large payloads, wiped by browser in low-storage mode).

### Action: Replace offline detection with real health-check + IndexedDB cache.

---

## 5. Schema (`backend/db/schema_core.sql`)

### Finding: Missing columns required by the full spec
- Missing: `source_id` / slug (uses `stable_id` varchar), `criteria_json` JSONB, `content_hash`, `parse_confidence`, `benefit_type`, `raw_payload`, `first_scraped_at`, `application_deadline`, level (central/state), sub-category, `benefit_amount_min/max`, `benefit_frequency`.
- Missing: `user_weight_profiles`, `global_weight_profile` tables.
- Missing: proper `name` as multilingual JSONB (has separate `name_en`, `name_hi` etc. columns — fragile for adding languages).
- Missing: `translations_cache` table.
- `financial_profiles` missing: `marital_status`, `disability_type`, `is_bpl`, `has_aadhaar`, `has_girl_child`, `education_level`, `rural_urban`, `religion`, `sub_occupation`.
- No migration system — raw SQL file only.

### Action: Complete schema rewrite with migrations (node-pg-migrate).

---

## 6. Backend (`backend/src/`)

### Finding: JavaScript, not TypeScript; no tests; CORS too restrictive
- All backend is plain JS despite spec requiring TypeScript.
- Zero test files anywhere in the project.
- CORS only allows `http://localhost:3000` — blocks other origins.
- No FastAPI service for Python engine (engine is called synchronously via child process with no pooling).
- `documents.js` route has a broken `answerFromText` call (imports a function that doesn't exist in ocrService).

### Action: Convert to TypeScript, add tests, wire FastAPI engine service.

---

## 7. Frontend (`frontend/`)

### Finding: No tests, no IndexedDB, incomplete voice integration
- Zero Playwright or Jest tests.
- `useOfflineQueue` uses localStorage only, not IndexedDB.
- `useTTS` and `VoiceButton` are built but not wired into the onboarding flow or results page.
- The document checker page exists but was never tested end-to-end.
- No "My Applications" screen.
- No admin/debug dashboard.

### Action: Wire voice into all screens. Add IndexedDB. Write Playwright tests.

---

## 8. What Is Genuinely Working (Keep)

| Component | Status | Notes |
|-----------|--------|-------|
| PostgreSQL service | Working | v16.15 |
| Express server skeleton | Keep | Will convert to TS |
| DB connection pool (`db.js`) | Keep | |
| Tesseract OCR (5.4.0) | Working | |
| pyttsx3 TTS | Working | |
| OCR preprocessing pipeline | Keep & improve | |
| `i18n/` translation files (hi, mr, ta, te, bn, en) | Keep structure | Fix fallback |
| Tailwind CSS config + globals | Keep | |
| PWA manifest + service worker skeleton | Keep | Upgrade to Workbox |
| 5-component scoring algorithm core | Keep | Expand to 8 |

---

## Tools Status

| Tool | Version | Status |
|------|---------|--------|
| Python | 3.12.10 | OK |
| Node.js | v24.19.0 | OK |
| Git | 2.55.0 | OK |
| PostgreSQL | 16.15 | OK |
| Tesseract | 5.4.0 | OK |
| Ollama | N/A | NOT INSTALLED — using rule-based NLP fallback for parsing; document summaries use rules |
| Playwright | installed | OK |
| scikit-learn | 1.9.1 | OK |
| httpx | installed | OK |
| FastAPI | installed | OK |
| Whisper | NOT installed | Will install; STT falls back to browser API |
| Piper TTS | NOT installed | Using pyttsx3; Piper upgrade documented |

---

## Rebuild Plan

**Phase 1:** Schema migration system + full new schema  
**Phase 2:** Real myscheme.gov.in API scraper (Playwright API discovery + httpx)  
**Phase 3:** Full recommendation engine (8 features, 3-valued, MMR, per-user weights)  
**Phase 4–7:** Document checker, voice, offline, IVR  

Start: Phase 1 now.
