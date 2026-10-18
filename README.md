# ArthSathi — AI-Powered Multilingual Financial Companion for Rural India

Free, offline-first Progressive Web App that helps underprivileged rural Indian users discover government schemes and insurance in their own language, by voice or text.

---

## Quick Start

```bash
# 1. Start the Python recommendation engine (FastAPI on :8001)
cd ml-model
python recommendation_engine.py

# 2. Start the backend API (Express on :3001)
cd backend
node server.js

# 3. Start the frontend (Next.js PWA on :3000)
cd frontend
npx next start

# 4. Open in browser
# http://localhost:3000
```

All three processes must be running. The database (PostgreSQL :5432, database `arthsathi`) must be running with the schema applied.

---

## Architecture

```
arthsathi/
├── frontend/          Next.js 15 PWA — onboarding, results, document checker
├── backend/           Node.js Express API — users, schemes, insurance, IVR, i18n
├── ml-model/          Python FastAPI — 8-feature recommendation engine
├── scraper/           Python — real myscheme.gov.in API scraper (326+ schemes)
├── i18n/              Shared question definitions + 6-language translations
└── docs/              AUDIT, ALGORITHM, MYSCHEME_API, phase reports
```

### Data Flow
```
[myscheme.gov.in API]
        ↓  (scraper/myscheme_scraper.py — daily)
[PostgreSQL: 326 schemes, 6 insurance]
        ↓  (backend reads DB, calls engine)
[Python FastAPI :8001 — 8-feature scoring + MMR]
        ↓
[Express API :3001 — user management, i18n, IVR]
        ↓
[Next.js PWA :3000 — adaptive onboarding, results, document checker]
```

---

## Database Setup (first time only)

```bash
# Apply schema (from arthsathi/ root)
psql -U postgres -h 127.0.0.1 -d arthsathi -f backend/migrations/001_initial_schema.sql
psql -U postgres -h 127.0.0.1 -d arthsathi -f backend/migrations/002_seed_insurance.sql

# Load schemes and insurance data from CSV
cd scraper
python load_to_db.py   # Loads 3400 schemes + 6 insurance policies (~10 sec)
```

---

## Features

### Multilingual (6 languages)
Hindi, Marathi, Tamil, Telugu, Bengali, English. Language selected first; every subsequent question, error, and audio prompt is in that language. Adding a 7th language = adding one JSON file. See `docs/ADDING_A_LANGUAGE.md`.

### Adaptive Onboarding
23 questions driven entirely by `i18n/questions.json` — no questions in code. Branches skip irrelevant questions (land only for farmers, disability type only if disabled, etc.). Target: ≤12 questions per user.

### Recommendation Engine
- **3400+ real schemes** loaded from validated CSV data
- **6 insurance policies** (PMJJBY, PMSBY, AB-PMJAY, PMFBY, AABY, NREGSLI)
- 8-feature weighted score: goal relevance, financial benefit, urgency match, eligibility margin, ease of access, coverage priority, category affinity, recency
- MMR diversity re-ranking: max 10 schemes, max 5 insurance
- Adaptive weights: per-user weight vector updated after every click/apply/dismiss
- See `docs/ALGORITHM.md` for the full formula

### Document Safety Checker
Photo a physical document → Tesseract OCR → risk clause detection → plain-language summary → TTS readout → Q&A grounded in document text. Detects: penalty clauses, collateral, irrevocable terms, blank amounts, farm-land pledge, auto-renewal.

### Offline-First PWA
Service worker caches app shell and API responses. Results cached in localStorage. Failed writes queued and retried on reconnect. Works fully after one successful sync.

### Voice Mode
- STT: `/api/voice/stt` → Whisper (falls back to browser Web Speech API)
- TTS: `/api/voice/tts` → pyttsx3 Windows SAPI (upgrade path: Piper)
- Every screen has a 🔊 replay button and mic input

---

## IVR — Phone Access for Feature-Phone Users

Full Twilio IVR flow is built and tested via simulator. The complete call flow:
1. Language selection (keypad 1–6)
2. Age, gender, caste, occupation, income, bank account (DTMF)
3. Recommendations read aloud in selected language

**One manual step to go live:**
1. Create a free account at [twilio.com](https://www.twilio.com)
2. Buy/provision a phone number with Voice capability
3. Set the incoming voice webhook to: `POST https://<your-server>/api/ivr/voice`
4. Add to `backend/.env`:
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_PHONE_NUMBER=+91xxxxxxxxxx
   ```

Test without Twilio: `GET http://localhost:3001/api/ivr/test`

---

## Self-Hosted AI Stack (zero paid APIs)

| Capability | Tool | Install |
|---|---|---|
| Speech-to-Text | OpenAI Whisper | `pip install openai-whisper` |
| Text-to-Speech | pyttsx3 (Windows SAPI) | pre-installed |
| TTS (production) | Piper | [github.com/rhasspy/piper](https://github.com/rhasspy/piper) |
| OCR | Tesseract 5 | `winget install UB-Mannheim.TesseractOCR` |
| Document Summary | Ollama + Mistral | install [ollama.com](https://ollama.com), then `ollama pull mistral` |
| Translation | Helsinki-NLP OPUS-MT | `pip install transformers sentencepiece` |

Ollama and Piper are optional — the system falls back to rule-based summarization and pyttsx3 TTS automatically.

---

## Environment Variables

`backend/.env`:
```
PORT=3001
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=arthsathi
DB_USER=postgres
DB_PASSWORD=postgres
ENGINE_URL=http://127.0.0.1:8001
FRONTEND_URL=http://localhost:3000
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
PYTHON_BIN=python
TWILIO_ACCOUNT_SID=   # optional — only for IVR
TWILIO_AUTH_TOKEN=    # optional
TWILIO_PHONE_NUMBER=  # optional
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | /api/health | Liveness probe |
| GET | /api/health/full | DB + engine + last scrape |
| POST | /api/users | Create/upsert user |
| GET | /api/users/:id | Get user |
| POST | /api/users/:id/profile | Save financial profile |
| GET | /api/users/:id/profile | Get financial profile |
| POST | /api/schemes/recommend | Personalised scheme recs (Python engine) |
| POST | /api/insurance/recommend | Insurance recs |
| POST | /api/schemes/event | Log click/apply/dismiss |
| GET | /api/schemes | List all schemes (paginated) |
| GET | /api/insurance | List insurance policies |
| POST | /api/documents/upload | Upload doc → OCR → risk analysis |
| GET | /api/documents/:id | Poll document result |
| POST | /api/documents/:id/question | Q&A on document |
| POST | /api/voice/stt | Speech-to-text |
| POST | /api/voice/tts | Text-to-speech |
| GET | /api/i18n/:lang/questions | Get question translations |
| POST | /api/ivr/voice | Twilio IVR webhook |
| GET | /api/ivr/test | IVR simulator test |

---

## Data Loading

```bash
# Load all schemes and insurance from CSV (recommended)
cd scraper
python load_to_db.py   # Loads 3400 schemes + 6 insurance policies

# Options:
python load_to_db.py --schemes     # Load schemes only
python load_to_db.py --insurance   # Load insurance only
```

**Data Source:** CSV files from reference repository (omkard0212/Major-Project) containing 3400+ validated schemes from myscheme.gov.in.

---

## Supported Languages

| Code | Language | Native |
|---|---|---|
| hi | Hindi | हिंदी |
| mr | Marathi | मराठी |
| ta | Tamil | தமிழ் |
| te | Telugu | తెలుగు |
| bn | Bengali | বাংলা |
| en | English | English |

---

## License
MIT — Free to use, modify, and deploy for social good.
