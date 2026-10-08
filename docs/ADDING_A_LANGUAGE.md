# Adding a New Language to ArthSathi

Adding a language requires adding files only — zero code changes.

## Step 1 — Create the question translation file

Copy `i18n/en/questions.json` to `i18n/<code>/questions.json` and translate all string values. Keep all keys identical.

```bash
cp i18n/en/questions.json i18n/gu/questions.json
# Edit i18n/gu/questions.json — translate all values to Gujarati
```

## Step 2 — Register the language

In `backend/src/routes/i18n.js`, add the language code to the `allowed` array:
```js
const allowed = ['hi', 'mr', 'ta', 'te', 'bn', 'en', 'gu'];  // add 'gu'
```

In `frontend/lib/i18n.ts`, add to the `LANGUAGES` map:
```ts
gu: { name: 'Gujarati', native: 'ગુજરાતી', ttsLocale: 'gu-IN', whisperCode: 'gu' },
```

In `frontend/app/onboarding/page.tsx`, add to the language grid:
```ts
// The LANGUAGES map drives the UI — no other code change needed
```

## Step 3 — Add a Tesseract language pack (for OCR)

```bash
# On Linux: apt-get install tesseract-ocr-guj
# On Windows: reinstall Tesseract selecting the Gujarati pack
```

In `ml-model/ocr_processor.py`, add to `lang_map`:
```python
lang_map = { ..., "gu": "guj" }
```

## Step 4 — Whisper handles Gujarati automatically

Whisper's multilingual model covers Gujarati natively — no change needed.

## Step 5 — TTS voice

Piper voices for Gujarati: download from https://github.com/rhasspy/piper/releases and add to `PIPER_VOICES_DIR`.

pyttsx3 fallback will use the OS Gujarati SAPI voice if installed.

## That's it — no other code changes required.

The onboarding, results, document checker, and IVR all pick up the new language automatically from the translation file and the LANGUAGES registry.
