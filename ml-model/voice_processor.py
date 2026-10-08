"""
ArthSathi — Voice Processing Pipeline
======================================

Provides:
  1. Speech-to-Text via self-hosted Whisper (openai-whisper)
  2. Text-to-Speech via system TTS (pyttsx3 on Windows, espeak on Linux)
     with Piper as the production path when available
  3. Translation via Helsinki-NLP opus-mt models (HuggingFace transformers)

All processing is fully local — no external APIs.

USAGE
-----
  python voice_processor.py --mode stt --audio /path/to/audio.webm --lang hi
  python voice_processor.py --mode tts --text "नमस्ते" --lang hi --output /tmp/out.wav
  python voice_processor.py --mode translate --text "Hello" --src en --tgt hi
"""

import os
import sys
import json
import logging
import argparse
import tempfile
from pathlib import Path

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ---------------------------------------------------------------------------
# Whisper STT
# ---------------------------------------------------------------------------

def speech_to_text(audio_path: str, language: str = "hi") -> dict:
    """
    Transcribe audio using self-hosted Whisper.
    Falls back to empty string if Whisper not installed.

    Whisper language codes map to our app's codes:
      hi → hi, mr → mr, ta → ta, te → te, bn → bn, en → en
    """
    try:
        import whisper

        # Use the small model by default — balances accuracy and speed on CPU
        # In production, upgrade to 'medium' for better multilingual accuracy
        model_size = os.getenv("WHISPER_MODEL", "small")
        log.info(f"Loading Whisper model: {model_size}")
        model = whisper.load_model(model_size)

        log.info(f"Transcribing audio: {audio_path}")
        result = model.transcribe(
            audio_path,
            language=language if language != "en" else None,
            fp16=False,  # CPU-compatible
            task="transcribe",
        )

        return {
            "success": True,
            "text": result["text"].strip(),
            "language": result.get("language", language),
            "segments": [
                {"start": s["start"], "end": s["end"], "text": s["text"]}
                for s in result.get("segments", [])
            ],
        }

    except ImportError:
        log.warning("Whisper not installed. Install with: pip install openai-whisper")
        return {"success": False, "text": "", "error": "Whisper not installed"}
    except Exception as e:
        log.error(f"STT error: {e}")
        return {"success": False, "text": "", "error": str(e)}


# ---------------------------------------------------------------------------
# TTS
# ---------------------------------------------------------------------------

def text_to_speech(text: str, language: str = "hi", output_path: str = None) -> dict:
    """
    Convert text to speech using:
    1. Piper (if installed) — high-quality neural TTS
    2. pyttsx3 (Windows fallback) — uses Windows SAPI voices
    3. espeak (Linux fallback)

    Returns path to generated WAV file.
    """
    if output_path is None:
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        output_path = tmp.name
        tmp.close()

    # Try Piper first (best quality for Indian languages)
    piper_result = _tts_piper(text, language, output_path)
    if piper_result["success"]:
        return piper_result

    # Fallback: pyttsx3 (Windows SAPI)
    pyttsx_result = _tts_pyttsx3(text, language, output_path)
    if pyttsx_result["success"]:
        return pyttsx_result

    # Last resort: espeak
    return _tts_espeak(text, language, output_path)


def _tts_piper(text: str, language: str, output_path: str) -> dict:
    """
    Use Piper neural TTS.
    Piper voices for Indian languages must be downloaded separately:
    https://github.com/rhasspy/piper/releases
    """
    import shutil, subprocess
    piper_bin = shutil.which("piper") or os.getenv("PIPER_PATH")
    if not piper_bin:
        return {"success": False, "error": "Piper not installed"}

    voice_map = {
        "hi": "hi_IN-male-medium",
        "mr": "mr_IN-male-medium",
        "en": "en_US-joe-medium",
        "ta": "ta_IN-male-medium",
        "te": "te_IN-male-medium",
        "bn": "bn_IN-male-medium",
    }
    voice = os.getenv("PIPER_VOICE", voice_map.get(language, "en_US-joe-medium"))
    voices_dir = os.getenv("PIPER_VOICES_DIR", str(Path.home() / ".local/share/piper-voices"))

    try:
        proc = subprocess.run(
            [piper_bin, "--model", f"{voices_dir}/{voice}.onnx",
             "--output_file", output_path],
            input=text.encode(),
            capture_output=True,
            timeout=30,
        )
        if proc.returncode == 0 and os.path.exists(output_path):
            return {"success": True, "output_path": output_path, "engine": "piper"}
        return {"success": False, "error": proc.stderr.decode()}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _tts_pyttsx3(text: str, language: str, output_path: str) -> dict:
    """Windows TTS via pyttsx3 + SAPI voices."""
    try:
        import pyttsx3
        engine = pyttsx3.init()
        engine.setProperty('rate', 140)   # Slower rate for better comprehension
        engine.setProperty('volume', 1.0)

        # Select voice language if available
        voices = engine.getProperty('voices')
        lang_prefixes = {"hi": "hin", "mr": "mar", "ta": "tam", "te": "tel", "bn": "ben"}
        target = lang_prefixes.get(language, language)
        for v in voices:
            if target in v.id.lower() or target in (v.languages[0] if v.languages else '').lower():
                engine.setProperty('voice', v.id)
                break

        engine.save_to_file(text, output_path)
        engine.runAndWait()

        if os.path.exists(output_path) and os.path.getsize(output_path) > 100:
            return {"success": True, "output_path": output_path, "engine": "pyttsx3"}
        return {"success": False, "error": "pyttsx3 produced empty output"}
    except ImportError:
        return {"success": False, "error": "pyttsx3 not installed"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def _tts_espeak(text: str, language: str, output_path: str) -> dict:
    """espeak fallback (Linux/universal)."""
    import shutil, subprocess
    if not shutil.which("espeak") and not shutil.which("espeak-ng"):
        return {"success": False, "error": "espeak not found"}

    lang_map = {"hi": "hi", "mr": "mr", "ta": "ta", "te": "te", "bn": "bn", "en": "en"}
    espeak_lang = lang_map.get(language, "en")

    try:
        cmd = shutil.which("espeak-ng") or "espeak"
        proc = subprocess.run(
            [cmd, "-v", espeak_lang, "-w", output_path, "-s", "140", text],
            capture_output=True, timeout=30
        )
        if proc.returncode == 0:
            return {"success": True, "output_path": output_path, "engine": "espeak"}
        return {"success": False, "error": proc.stderr.decode()}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

def translate_text(text: str, src_lang: str = "en", tgt_lang: str = "hi") -> dict:
    """
    Translate text using Helsinki-NLP OPUS-MT models (HuggingFace transformers).
    Models are downloaded on first use and cached locally.
    Works fully offline after initial download.

    Supported pairs:
      en→hi, en→mr, en→ta, en→te, en→bn
      hi→en, mr→en, ta→en, te→en, bn→en
    """
    if src_lang == tgt_lang:
        return {"success": True, "translated_text": text, "model": "passthrough"}

    try:
        from transformers import MarianMTModel, MarianTokenizer

        model_name = f"Helsinki-NLP/opus-mt-{src_lang}-{tgt_lang}"
        # Fallback: some pairs use multi-language models
        fallback_pairs = {
            ("en", "mr"): "Helsinki-NLP/opus-mt-en-mul",
            ("en", "te"): "Helsinki-NLP/opus-mt-en-mul",
            ("en", "bn"): "Helsinki-NLP/opus-mt-en-ben",
        }
        model_name = fallback_pairs.get((src_lang, tgt_lang), model_name)

        log.info(f"Loading translation model: {model_name}")
        tokenizer = MarianTokenizer.from_pretrained(model_name)
        model     = MarianMTModel.from_pretrained(model_name)

        inputs = tokenizer([text], return_tensors="pt", padding=True, truncation=True, max_length=512)
        translated = model.generate(**inputs)
        result_text = tokenizer.decode(translated[0], skip_special_tokens=True)

        return {"success": True, "translated_text": result_text, "model": model_name}

    except ImportError:
        return {"success": False, "translated_text": text,
                "error": "transformers not installed. Run: pip install transformers sentencepiece"}
    except Exception as e:
        log.error(f"Translation error: {e}")
        return {"success": False, "translated_text": text, "error": str(e)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ArthSathi Voice Processor")
    parser.add_argument("--mode",   required=True, choices=["stt", "tts", "translate"])
    parser.add_argument("--audio",  help="Audio file path (for STT)")
    parser.add_argument("--text",   help="Text to process (TTS or translate)")
    parser.add_argument("--lang",   default="hi", help="Language code")
    parser.add_argument("--src",    default="en",  help="Source language (translate)")
    parser.add_argument("--tgt",    default="hi",  help="Target language (translate)")
    parser.add_argument("--output", default=None,  help="Output file path (TTS)")
    args = parser.parse_args()

    if args.mode == "stt":
        result = speech_to_text(args.audio, args.lang)
    elif args.mode == "tts":
        result = text_to_speech(args.text, args.lang, args.output)
    elif args.mode == "translate":
        result = translate_text(args.text, args.src, args.tgt)
    else:
        result = {"error": "Unknown mode"}

    print(json.dumps(result, ensure_ascii=False, indent=2))
