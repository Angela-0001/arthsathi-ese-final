from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json
import base64
import wave
import os
import asyncio
import io
import subprocess
import requests
from gtts import gTTS
from imageio_ffmpeg import get_ffmpeg_exe
import speech_recognition as sr

app = FastAPI()

# ==========================================
# CONFIG
# ==========================================
ARTHSATHI_BACKEND = os.getenv("BACKEND_URL", "http://localhost:3001")
FFMPEG = get_ffmpeg_exe()
CHUNK_SIZE = 1600  # 100ms at 8kHz

# In-memory sessions
SESSIONS = {}

# ==========================================
# HELPERS
# ==========================================

def mp3_to_pcm_8k_mono(mp3_bytes: bytes) -> bytes:
    """Convert MP3 → PCM 8kHz mono using ffmpeg."""
    result = subprocess.run(
        [FFMPEG, "-y", "-f", "mp3", "-i", "pipe:0", "-ar", "8000", "-ac", "1", "-f", "s16le", "pipe:1"],
        input=mp3_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL
    )
    return result.stdout


async def send_pcm_to_exotel(websocket, pcm_data: bytes, stream_sid: str):
    """Send PCM audio to Exotel in chunks."""
    try:
        for i in range(0, len(pcm_data), CHUNK_SIZE):
            chunk = pcm_data[i:i + CHUNK_SIZE]
            payload = {
                "event": "media",
                "streamSid": stream_sid,
                "media": {"payload": base64.b64encode(chunk).decode("utf-8")}
            }
            await websocket.send_text(json.dumps(payload))
    except Exception as e:
        print(f"❌ Error sending audio: {e}")


async def speak(websocket, text: str, lang: str, stream_sid: str):
    """Speak text via TTS and send to Exotel."""
    print(f"🔊 SPEAKING [{lang}]: {text}")
    
    lang_map = {"hi": "hi", "en": "en", "mr": "mr"}
    tts_lang = lang_map.get(lang, "hi")
    
    mp3_buffer = io.BytesIO()
    gTTS(text=text, lang=tts_lang, slow=False).write_to_fp(mp3_buffer)
    mp3_buffer.seek(0)
    
    pcm_data = mp3_to_pcm_8k_mono(mp3_buffer.read())
    await send_pcm_to_exotel(websocket, pcm_data, stream_sid)


def transcribe_audio(wav_path: str, lang: str) -> str:
    """Transcribe audio using Google Speech Recognition."""
    lang_map = {"hi": "hi-IN", "en": "en-IN", "mr": "mr-IN"}
    google_lang = lang_map.get(lang, "hi-IN")
    
    recognizer = sr.Recognizer()
    try:
        with sr.AudioFile(wav_path) as source:
            audio = recognizer.record(source)
            text = recognizer.recognize_google(audio, language=google_lang)
            print(f"✅ TRANSCRIBED: {text}")
            return text
    except sr.UnknownValueError:
        print(f"❌ STT: Could not understand audio (silence or unclear)")
        return ""
    except sr.RequestError as e:
        print(f"❌ STT API error: {e}")
        return ""
    except Exception as e:
        print(f"❌ STT ERROR: {e}")
        return ""


def get_arthsathi_response(user_query: str, lang: str, caller_id: str) -> str:
    """Call ArthSathi backend for schemes/insurance."""
    try:
        response = requests.post(
            f"{ARTHSATHI_BACKEND}/api/gateway/message",
            json={
                "raw_text": user_query,
                "caller_id": caller_id,
                "channel": "ivr",
                "intent": "general_query",
                "detected_language": lang
            },
            timeout=15
        )
        response.raise_for_status()
        return response.json().get("text_response", "मुझे खेद है, मुझे आपका जवाब नहीं मिला।")
    except Exception as e:
        print(f"❌ Backend error: {e}")
        return "मुझे खेद है, कुछ गलत हो गया। कृपया दोबारा प्रयास करें।"


# ==========================================
# WEBSOCKET HANDLER
# ==========================================

@app.websocket("/media")
async def handle_call(websocket: WebSocket):
    await websocket.accept()
    print("\n🟢 EXOTEL CONNECTED")
    
    stream_sid = None
    lang = "hi"
    audio_buffer = bytearray()
    is_processing = False
    is_speaking = False
    
    try:
        async for message in websocket.iter_text():
            data = json.loads(message)
            event = data.get("event")
            
            # ==========================================
            # CONNECTION START
            # ==========================================
            if event == "connected":
                print("✅ Exotel connection established")
            
            # ==========================================
            # STREAM START
            # ==========================================
            elif event == "start":
                # streamSid can be at top level or inside start dict
                stream_sid = (
                    data.get("streamSid") or
                    data.get("start", {}).get("streamSid") or
                    data.get("start", {}).get("stream_sid") or
                    "default_stream"
                )
                params = dict(websocket.query_params)
                lang = params.get("lang", "hi")
                
                print(f"🎙️ STREAM STARTED - SID: {stream_sid}, LANG: {lang}")
                print(f"📦 Raw start data: {json.dumps(data)[:200]}")
                
                # Store session
                SESSIONS[stream_sid] = {
                    "lang": lang,
                    "conversation_turn": 0
                }
                
                # Welcome message
                welcome_msg = {
                    "hi": "नमस्ते! मैं आर्थसाथी हूं। आप मुझसे सरकारी योजना या बीमा के बारे में पूछ सकते हैं।",
                    "en": "Hello! I am ArthSathi. You can ask me about government schemes or insurance.",
                    "mr": "नमस्कार! मी आर्थसाथी आहे. तुम्ही मला सरकारी योजना किंवा विम्याबद्दल विचारू शकता."
                }.get(lang, "Hello! I am ArthSathi.")
                
                await speak(websocket, welcome_msg, lang, stream_sid)
                # Flush buffer after speaking so we don't process echo
                audio_buffer.clear()
                is_speaking = False
            
            # ==========================================
            # AUDIO DATA
            # ==========================================
            elif event == "media":
                if is_processing or is_speaking or not stream_sid:
                    continue
                
                payload = data.get("media", {}).get("payload")
                if payload:
                    chunk = base64.b64decode(payload)
                    # Simple energy check — skip near-silent chunks
                    import struct
                    samples = struct.unpack(f"{len(chunk)//2}h", chunk)
                    energy = sum(abs(s) for s in samples) / len(samples)
                    if energy > 100:  # Only add if there's actual audio
                        audio_buffer.extend(chunk)
                
                # Process after ~3 seconds of actual audio
                if len(audio_buffer) >= 48000 and not is_processing:
                    is_processing = True
                    
                    session = SESSIONS.get(stream_sid, {})
                    turn = session.get("conversation_turn", 0) + 1
                    session["conversation_turn"] = turn
                    
                    print(f"\n🔴 PROCESSING TURN {turn} - Buffer: {len(audio_buffer)} bytes")
                    
                    # Save audio to WAV
                    wav_path = f"caller_turn_{turn}.wav"
                    with wave.open(wav_path, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(8000)
                        wf.writeframes(bytes(audio_buffer))
                    
                    audio_buffer.clear()
                    
                    # Transcribe
                    user_text = transcribe_audio(wav_path, lang)
                    
                    if user_text:
                        response_text = get_arthsathi_response(user_text, lang, stream_sid)
                        is_speaking = True
                        await speak(websocket, response_text, lang, stream_sid)
                        is_speaking = False
                        audio_buffer.clear()
                    else:
                        retry_msg = {
                            "hi": "मुझे समझ नहीं आया। कृपया फिर से बोलें।",
                            "en": "I didn't understand. Please speak again.",
                            "mr": "मला समजले नाही. कृपया पुन्हा बोला."
                        }.get(lang, "I didn't understand.")
                        is_speaking = True
                        await speak(websocket, retry_msg, lang, stream_sid)
                        is_speaking = False
                        audio_buffer.clear()
                    
                    # Clean up
                    try:
                        os.remove(wav_path)
                    except:
                        pass
                    
                    is_processing = False
            
            # ==========================================
            # STOP
            # ==========================================
            elif event == "stop":
                print("🛑 STREAM STOPPED")
                if stream_sid in SESSIONS:
                    del SESSIONS[stream_sid]
    
    except WebSocketDisconnect:
        print("🔴 EXOTEL DISCONNECTED")
        if stream_sid in SESSIONS:
            del SESSIONS[stream_sid]
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


@app.get("/")
def health():
    return {"status": "ArthSathi IVR running", "sessions": len(SESSIONS)}
