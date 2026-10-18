# -*- coding: utf-8 -*-
"""ArthSathi IVR – Exotel WebSocket voicebot. Python 3.13 compatible."""

import asyncio, base64, io, json, os, struct, subprocess, sys, wave
import requests, speech_recognition as sr
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from gtts import gTTS
from imageio_ffmpeg import get_ffmpeg_exe

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eligibility_engine import find_matching_schemes
from question_flow import clear_session, get_session, start_session, submit_answer

app    = FastAPI()
FFMPEG = get_ffmpeg_exe()
CHUNK  = 1600
BACKEND = os.getenv("BACKEND_URL", "http://localhost:3001")

# Tune these for smoothness:
ENERGY_GATE    = 60     # RMS below this = silence
MIN_SPEECH_CHK = 6      # need at least this many speech chunks before we process
SILENCE_AFTER  = 10     # consecutive silent chunks after speech = end of utterance
MAX_BUFFER     = 64000  # safety cap – process even if caller never pauses

RETRY = {
    "hi": "Mujhe samajh nahi aaya. Kripya phir se boliye.",
    "en": "I did not understand. Please speak again.",
    "mr": "Mala samajale nahi. Kripaya puna bolaa.",
}
BYE = {
    "hi": "Dhanyavaad. Arthsathi dot in par jaake aur jankari le sakte hain.",
    "en": "Thank you. Visit arthsathi dot in for more information.",
    "mr": "Dhanyavaad. Arthsathi dot in var adhik mahiti milel.",
}
HDR = {
    "hi": "Aapke liye yeh yojanaen hain.",
    "en": "Here are the schemes for you.",
    "mr": "Tumchyasathi ya yojana ahet.",
}
FALLBACK = {
    "hi": "PM Kisan yojana ke tahat kisanon ko 6000 rupaye milte hain. Ayushman Bharat mein 5 lakh tak muft ilaaj milta hai.",
    "en": "PM Kisan gives farmers 6000 rupees per year. Ayushman Bharat gives free treatment up to 5 lakhs.",
    "mr": "PM Kisan yojane antargat shetkaryanna 6000 rupaye miltat.",
}
GTTS_L = {"hi": "hi", "en": "en", "mr": "mr"}
STT_L  = {"hi": "hi-IN", "en": "en-IN", "mr": "mr-IN"}


# ── audio helpers ─────────────────────────────────────────────────────────

def mp3_to_pcm(mp3: bytes) -> bytes:
    r = subprocess.run(
        [FFMPEG, "-y", "-f", "mp3", "-i", "pipe:0", "-ar", "8000", "-ac", "1", "-f", "s16le", "pipe:1"],
        input=mp3, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    )
    return r.stdout


async def send_pcm(ws: WebSocket, pcm: bytes, sid: str) -> None:
    for i in range(0, len(pcm), CHUNK):
        await ws.send_text(json.dumps({
            "event": "media", "streamSid": sid,
            "media": {"payload": base64.b64encode(pcm[i:i+CHUNK]).decode()},
        }))


async def speak(ws: WebSocket, text: str, lang: str, sid: str) -> None:
    if not text or not text.strip():
        return
    print(f"[TTS/{lang}] {text[:100]}")
    buf = io.BytesIO()
    try:
        gTTS(text=text, lang=GTTS_L.get(lang, "hi"), slow=False).write_to_fp(buf)
    except Exception as e:
        print(f"[TTS] gTTS error: {e}")
        return
    buf.seek(0)
    pcm = mp3_to_pcm(buf.read())
    if pcm:
        await send_pcm(ws, pcm, sid)


# ── STT ───────────────────────────────────────────────────────────────────

def transcribe(wav_path: str, lang: str) -> str:
    rec = sr.Recognizer()
    try:
        with sr.AudioFile(wav_path) as src:
            audio = rec.record(src)
            text = rec.recognize_google(audio, language=STT_L.get(lang, "hi-IN"))
            print(f"[STT] {text}")
            return text
    except sr.UnknownValueError:
        print("[STT] unclear")
        return ""
    except Exception as e:
        print(f"[STT] error: {e}")
        return ""


# ── scheme response ───────────────────────────────────────────────────────

def get_schemes_response(profile: dict, lang: str) -> str:
    matches = []
    try:
        matches = find_matching_schemes(profile)
    except Exception as e:
        print(f"[ENGINE] {e}")

    if not matches:
        try:
            kw = " ".join(filter(None, [profile.get("occupation",""), profile.get("social_category","")])) or "farmer"
            r = requests.get(f"{BACKEND}/api/schemes", params={"q": kw, "limit": 3}, timeout=4)
            if r.ok:
                raw = r.json()
                items = raw if isinstance(raw, list) else raw.get("data", raw.get("schemes", []))
                for it in items[:3]:
                    n = it.get("name", {})
                    b = it.get("benefits", it.get("description", {}))
                    matches.append({"name": n, "benefits": b})
        except Exception as e:
            print(f"[API] {e}")

    if not matches:
        return FALLBACK.get(lang, FALLBACK["en"])

    parts = [HDR.get(lang, HDR["en"])]
    for m in matches[:2]:
        n = m.get("name", {})
        name = (n.get(lang) or n.get("en") or n.get("hi") or str(n)) if isinstance(n, dict) else str(n)
        b = m.get("benefits", {})
        ben  = (b.get(lang) or b.get("en") or b.get("hi") or "") if isinstance(b, dict) else str(b)
        if name: parts.append(name)
        if ben:  parts.append(str(ben)[:150])
    return "  ".join(parts)


# ── health ────────────────────────────────────────────────────────────────

@app.get("/")
def health():
    return {"status": "IVR running"}


# ── WebSocket handler ─────────────────────────────────────────────────────

@app.websocket("/media")
async def media_handler(ws: WebSocket):
    await ws.accept()
    print("\n[IVR] connected")

    stream_sid   = None
    lang         = "hi"
    audio_buf    = bytearray()
    speech_chk   = 0        # chunks with speech energy
    silence_chk  = 0        # consecutive silent chunks after speech
    is_speaking  = False
    is_processing = False
    turn         = 0

    params = dict(ws.query_params)
    lang   = params.get("lang", "hi")

    try:
        async for raw in ws.iter_text():
            data  = json.loads(raw)
            event = data.get("event")

            # connected -------------------------------------------------------
            if event == "connected":
                print("[IVR] stream connected")

            # start -----------------------------------------------------------
            elif event == "start":
                stream_sid = (
                    data.get("streamSid")
                    or data.get("start", {}).get("streamSid", "default")
                )
                print(f"[IVR] START sid={stream_sid} lang={lang}")
                first_q = start_session(stream_sid, lang)
                print(f"[IVR] Q1: {first_q}")
                is_speaking = True
                await speak(ws, first_q, lang, stream_sid)
                is_speaking = False
                await asyncio.sleep(1.5)   # wait before listening
                audio_buf.clear()
                speech_chk  = 0
                silence_chk = 0

            # media -----------------------------------------------------------
            elif event == "media":
                if is_speaking or is_processing or stream_sid is None:
                    continue

                payload = data.get("media", {}).get("payload")
                if payload:
                    chunk = base64.b64decode(payload)
                    if len(chunk) >= 2:
                        samples = struct.unpack(f"{len(chunk)//2}h", chunk)
                        energy  = sum(abs(s) for s in samples) / len(samples)
                        if energy > ENERGY_GATE:
                            audio_buf.extend(chunk)
                            speech_chk += 1
                            silence_chk  = 0
                        elif speech_chk > 0:
                            # silence after speech
                            silence_chk += 1

                # Trigger conditions:
                #  A) caller paused after speaking (silence detected)
                #  B) buffer too full (safety cap)
                trigger = (
                    (speech_chk >= MIN_SPEECH_CHK and silence_chk >= SILENCE_AFTER) or
                    len(audio_buf) >= MAX_BUFFER
                )

                if trigger and not is_processing and len(audio_buf) > 3200:
                    is_processing = True
                    speech_chk  = 0
                    silence_chk = 0
                    turn += 1
                    print(f"\n[IVR] TURN {turn}  buf={len(audio_buf)} bytes")

                    wav = f"turn_{turn}.wav"
                    with wave.open(wav, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(8000)
                        wf.writeframes(bytes(audio_buf))
                    audio_buf.clear()

                    answer = transcribe(wav, lang)
                    try: os.remove(wav)
                    except: pass

                    is_speaking = True
                    if answer:
                        session = get_session(stream_sid)
                        if session:
                            next_q, done = submit_answer(stream_sid, answer)
                            if done:
                                profile = session.get("answers", {})
                                result  = get_schemes_response(profile, lang)
                                await speak(ws, result, lang, stream_sid)
                                await speak(ws, BYE.get(lang, BYE["en"]), lang, stream_sid)
                                clear_session(stream_sid)
                            else:
                                await speak(ws, next_q, lang, stream_sid)
                        else:
                            await speak(ws, get_schemes_response({"occupation": answer}, lang), lang, stream_sid)
                    else:
                        await speak(ws, RETRY.get(lang, RETRY["en"]), lang, stream_sid)

                    is_speaking = False
                    await asyncio.sleep(1.5)
                    audio_buf.clear()
                    is_processing = False

            # stop ------------------------------------------------------------
            elif event == "stop":
                print("[IVR] STOP")
                if stream_sid:
                    clear_session(stream_sid)

    except WebSocketDisconnect:
        print("[IVR] disconnected")
        if stream_sid:
            clear_session(stream_sid)
    except Exception as e:
        import traceback
        print(f"[IVR] ERROR: {e}")
        traceback.print_exc()
