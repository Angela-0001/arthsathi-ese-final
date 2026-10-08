# Phase 1 Report — Foundation, Audit, and Schema

**Status:** COMPLETE  
**Date:** 2026-10-08

## What Was Built

### Audit (`docs/AUDIT.md`)
Full audit of the prior codebase. Key findings:
- 6 hardcoded (not scraped) schemes in old DB
- Onboarding questions were TypeScript code, not data-driven
- Offline detection used `?offline=1` URL param — unreliable
- Schema missing 15+ required columns

### New Monorepo Structure
```
arthsathi/
├── frontend/        Next.js 15 PWA (TypeScript + Tailwind)
├── backend/         Node.js + Express (v2 routes, new schema)
├── ml-model/        Python 8-feature recommendation engine (FastAPI)
├── scraper/         Real myscheme.gov.in API scraper
├── i18n/            Shared question definitions + 6 language translations
└── docs/            AUDIT, MYSCHEME_API, ALGORITHM, PHASE reports
```

### New PostgreSQL Schema (`migrations/001_initial_schema.sql`)
12 tables, 17 enum types, 40+ indexes:
- `users` — identity, consent, language, mode, residence_type
- `financial_profiles` — 40+ fields covering all eligibility criteria
- `schemes` — JSONB multilingual names, full structured eligibility, criteria_json, content_hash
- `insurance_policies` — same pattern
- `user_scheme_matches` / `user_insurance_matches` — score breakdown JSONB, session tracking
- `user_weight_profiles` — per-user 8-weight vector + category_affinity
- `global_weight_profile` — population-level prior with NDCG evaluation
- `interaction_events` — append-only event log, idempotent via client_event_id
- `documents` — OCR + risk flags + conversation history
- `scraping_log` — full run audit trail
- `translations_cache` — dynamically translated scheme text

### Servers Verified Running
- Backend: http://localhost:3001 → 200 OK, DB connected
- Python Engine: http://127.0.0.1:8001 → 200 OK
- Frontend: http://localhost:3000 → 200 OK

## Verified Output
```
Tables: 12 | Enums: 17 | Indexes: 40+
Backend health: {"status":"ok","service":"arthsathi-backend","version":"2.0.0"}
DB health: {"database":"connected"}
```

## Known Gaps
- No test suite yet (written in Phase 3/4)
- TypeScript migration of backend partially done (routes are JS with JSDoc types)
