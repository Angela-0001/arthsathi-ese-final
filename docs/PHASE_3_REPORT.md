# Phase 3 Report — Recommendation Engine + Adaptive Onboarding

**Status:** COMPLETE  
**Date:** 2026-10-08

## What Was Built

### 3A. Adaptive Onboarding
- **Questions are data, not code**: defined in `i18n/questions.json` with branching conditions
- **23 questions total**, all with `depends_on` / `show` conditions:
  - `land_holding_acres` only shown for farmers
  - `disability_type` only if `has_disability = true`
  - `is_widow` only for women
  - `jan_dhan` only if `has_bank_account = true`
  - `education_level` only for students
  - etc.
- **Language-driven**: fetched via `/api/i18n/:lang/questions`, all 6 languages verified
- **Voice mode**: questions read via browser speechSynthesis, answer accepted via Whisper STT or browser Web Speech API fallback
- **Large touch targets**: 56px minimum, icon-first design throughout

### 3B. Ration Card Page (Fixed)
Correct card types with colour coding and plain explanations:
- **AAY** (Antyodaya) — yellow — poorest of poor
- **PHH** — priority household (BPL)
- **NPHH** — non-priority (APL)
- **Annapurna** — destitute senior citizens
- **State Other** — state-specific variants
- `none` / `applied` options
Feeds `is_bpl` flag automatically (AAY/PHH → `is_bpl = true`)

### 3C. 8-Feature Recommendation Engine (`ml-model/recommendation_engine.py`)

**Stage 1: Three-valued eligibility** — PASS / FAIL / UNKNOWN
- 14 criterion checks per scheme
- Any FAIL → excluded
- All PASS → `eligible`
- PASS + some UNKNOWN → `likely` (with penalty and missing_criteria list)
- State filter skips "All" → all-India schemes pass

**Stage 2: 8-feature weighted score**
```
score = w1×goalRelevance + w2×financialBenefit + w3×urgencyMatch +
        w4×eligibilityMargin + w5×easeOfAccess + w6×coveragePriority +
        w7×categoryAffinity + w8×recencyDeadline
Initial weights: 0.25, 0.20, 0.15, 0.12, 0.08, 0.08, 0.07, 0.05
```

**Stage 3: MMR diversity re-ranking**
- λ=0.8 diversity factor prevents 10 near-identical schemes
- ε=10% exploration slot for novel categories

**Stage 4: Per-user adaptive weights**
- Multiplicative-weights update after click/apply/dismiss events
- Decaying learning rate η_t = 0.1 / (1 + t/50)
- Regularized toward global prior (α=5%) to prevent cold-start drift
- Written to `user_weight_profiles` table with version history

### Verified Engine Test Results (3 real profiles)

**Farmer SC 35 Maharashtra** → 5 eligible schemes from 326  
**Widow ST 28 UP** → 5 eligible schemes  
**Student SC 21 Tamil Nadu** → 5 eligible schemes  
Top result for student: "Agnipath Yojana" (education/employment)

### 3D. FastAPI Service
- Running on `http://127.0.0.1:8001`
- Endpoints: `/recommend`, `/event`, `/retrain`, `/health`
- Backend proxies through `engineService.js`
- Falls back to DB cache if engine unreachable (offline support)

### Offline Fix (Results Page)
- Real HTTP ping to `/api/health` with 5s timeout + 2 retries
- Falls back to localStorage cache with "Offline — showing saved results" banner
- Never shows blocking "No internet connection" screen

## Actual Verified Output
```bash
GET /api/health/full
→ {"services":{"database":{"status":"ok"},"engine":{"status":"ok"}}}
  counts: {schemes:326, insurance:6, users:5}

POST /api/schemes/recommend {user_id: "...", limit: 10}
→ {"success":true,"source":"engine","data":[10 schemes with scores/breakdowns]}

POST /api/insurance/recommend {user_id: "..."}
→ {"success":true,"source":"engine","data":[5 insurance plans]}

GET /api/i18n/hi/questions → age.question: "आपकी उम्र कितनी है?"
GET /api/i18n/ta/questions → age.question: "உங்கள் வயது என்ன?"
GET /api/i18n/mr/questions → occupation.question: "तुमचे मुख्य काम काय आहे?"
GET /api/i18n/te/questions → 200 OK (Telugu)
GET /api/i18n/bn/questions → 200 OK (Bengali)
GET /api/i18n/en/questions → 200 OK (English)
```

## Known Gaps
- Schemes with no eligibility text have equal scores — distinguish by adding more `requires_*` flags via full scrape
- `explain_text` relies on keyword matching; would improve with sentence embeddings
- Global retraining (nightly logistic regression) is implemented but not yet scheduled
