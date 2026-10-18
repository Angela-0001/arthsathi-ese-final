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
SESSIONS = {}

# ==========================================
# QUESTIONNAIRE DEFINITION
# ==========================================

QUESTIONS = {
    "hi": [
        {"key": "age",        "text": "आपकी उम्र कितनी है? कृपया बोलें।"},
        {"key": "gender",     "text": "आप पुरुष हैं या महिला? पुरुष के लिए 'पुरुष' बोलें, महिला के लिए 'महिला' बोलें।"},
        {"key": "occupation", "text": "आप क्या काम करते हैं? जैसे किसान, मजदूर, व्यापारी, या नौकरी।"},
        {"key": "income",     "text": "आपकी महीने की आमदनी कितनी है रुपयों में? बोलें जैसे पाँच हजार या दस हजार।"},
        {"key": "caste",      "text": "आपकी जाति श्रेणी क्या है? सामान्य, ओबीसी, एससी, या एसटी?"},
    ],
    "en": [
        {"key": "age",        "text": "How old are you? Please say your age."},
        {"key": "gender",     "text": "What is your gender? Say male or female."},
        {"key": "occupation", "text": "What is your occupation? Say farmer, laborer, trader, or employed."},
        {"key": "income",     "text": "What is your monthly income in rupees?"},
        {"key": "caste",      "text": "What is your caste category? Say general, OBC, SC, or ST."},
    ],
    "mr": [
        {"key": "age",        "text": "तुमचे वय किती आहे? कृपया सांगा।"},
        {"key": "gender",     "text": "तुम्ही पुरुष आहात की महिला?"},
        {"key": "occupation", "text": "तुम्ही काय काम करता? जसे शेतकरी, मजूर, व्यापारी किंवा नोकरी।"},
        {"key": "income",     "text": "तुमची महिन्याची कमाई किती रुपये आहे?"},
        {"key": "caste",      "text": "तुमची जात श्रेणी काय आहे? सामान्य, ओबीसी, एससी, किंवा एसटी?"},
    ],
}

# ==========================================
# ANSWER EXTRACTORS
# ==========================================

def extract_age(text: str) -> int:
    """Extract age from spoken text."""
    import re
    # Hindi number words
    hindi_nums = {"एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5,
                  "छह": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10,
                  "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50,
                  "साठ": 60, "सत्तर": 70, "अस्सी": 80, "नब्बे": 90}
    
    # Try direct number extraction
    nums = re.findall(r'\d+', text)
    if nums:
        age = int(nums[0])
        if 1 <= age <= 100:
            return age
    
    # Try Hindi words
    text_lower = text.lower()
    for word, val in hindi_nums.items():
        if word in text_lower:
            return val
    
    return 30  # default


def extract_gender(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["महिला", "female", "woman", "lady", "स्त्री", "महिला"]):
        return "female"
    return "male"


def extract_occupation(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["किसान", "खेती", "farmer", "shetkari", "kisan", "farming"]):
        return "farmer"
    elif any(w in text_lower for w in ["मजदूर", "मजूर", "labourer", "labor", "mazdoor", "daily wage"]):
        return "daily_wage"
    elif any(w in text_lower for w in ["व्यापार", "business", "trader", "shop", "दुकान"]):
        return "self_employed"
    elif any(w in text_lower for w in ["नौकरी", "job", "employed", "sarkari", "government"]):
        return "private_employee"
    elif any(w in text_lower for w in ["निर्माण", "construction", "building"]):
        return "construction_worker"
    return "other"


def extract_income(text: str) -> int:
    import re
    hindi_nums = {
        "एक हजार": 1000, "दो हजार": 2000, "तीन हजार": 3000, "चार हजार": 4000,
        "पाँच हजार": 5000, "पांच हजार": 5000, "छह हजार": 6000, "सात हजार": 7000,
        "आठ हजार": 8000, "नौ हजार": 9000, "दस हजार": 10000,
        "पंद्रह हजार": 15000, "बीस हजार": 20000, "पच्चीस हजार": 25000,
        "तीस हजार": 30000, "पचास हजार": 50000,
    }
    
    text_lower = text.lower()
    for phrase, val in hindi_nums.items():
        if phrase in text_lower:
            return val
    
    nums = re.findall(r'\d+', text)
    if nums:
        n = int(nums[0])
        if n > 100:
            return n
        elif n > 0:
            return n * 1000  # Assume "5" means 5000
    
    return 5000  # default


def extract_caste(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["एससी", "sc", "scheduled caste", "अनुसूचित जाति"]):
        return "sc"
    elif any(w in text_lower for w in ["एसटी", "st", "scheduled tribe", "आदिवासी"]):
        return "st"
    elif any(w in text_lower for w in ["ओबीसी", "obc", "other backward"]):
        return "obc"
    return "general"


# ==========================================
# HELPERS
# ==========================================

def mp3_to_pcm_8k_mono(mp3_bytes: bytes) -> bytes:
    result = subprocess.run(
        [FFMPEG, "-y", "-f", "mp3", "-i", "pipe:0", "-ar", "8000", "-ac", "1", "-f", "s16le", "pipe:1"],
        input=mp3_bytes, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    return result.stdout


async def send_pcm_to_exotel(websocket, pcm_data: bytes, stream_sid: str):
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
    print(f"🔊 SPEAKING [{lang}]: {text[:80]}...")
    lang_map = {"hi": "hi", "en": "en", "mr": "mr"}
    tts_lang = lang_map.get(lang, "hi")
    mp3_buffer = io.BytesIO()
    gTTS(text=text, lang=tts_lang, slow=False).write_to_fp(mp3_buffer)
    mp3_buffer.seek(0)
    pcm_data = mp3_to_pcm_8k_mono(mp3_buffer.read())
    await send_pcm_to_exotel(websocket, pcm_data, stream_sid)


def transcribe_audio(wav_path: str, lang: str) -> str:
    lang_map = {"hi": "hi-IN", "en": "en-IN", "mr": "mr-IN"}
    recognizer = sr.Recognizer()
    try:
        with sr.AudioFile(wav_path) as source:
            audio = recognizer.record(source)
            text = recognizer.recognize_google(audio, language=lang_map.get(lang, "hi-IN"))
            print(f"✅ TRANSCRIBED: {text}")
            return text
    except sr.UnknownValueError:
        print("❌ STT: Could not understand audio")
        return ""
    except Exception as e:
        print(f"❌ STT ERROR: {e}")
        return ""


def get_recommendations(profile: dict, lang: str) -> str:
    """Query backend for scheme recommendations based on user profile."""
    try:
        # Save user profile to backend
        user_resp = requests.post(
            f"{ARTHSATHI_BACKEND}/api/users",
            json={
                "preferred_language": lang,
                "interaction_mode": "voice",
            },
            timeout=10
        )
        
        user_id = None
        if user_resp.status_code == 200:
            user_id = user_resp.json().get("data", {}).get("id")

        # Build search query from profile
        occ = profile.get("occupation", "other")
        caste = profile.get("caste", "general")
        income = profile.get("income", 5000)
        
        search_terms = []
        if occ in ["farmer", "farm_laborer"]:
            search_terms.append("farmer kisan agriculture")
        if income < 10000:
            search_terms.append("bpl poor income")
        if caste in ["sc", "st"]:
            search_terms.append("SC ST schedule")
        if not search_terms:
            search_terms.append("government scheme")
        
        # Search schemes
        schemes = []
        for term in search_terms[:2]:
            resp = requests.get(
                f"{ARTHSATHI_BACKEND}/api/schemes",
                params={"q": term, "limit": 2},
                timeout=15
            )
            if resp.status_code == 200:
                schemes.extend(resp.json().get("data", []))

        # Remove duplicates
        seen = set()
        unique_schemes = []
        for s in schemes:
            sid = s.get("id")
            if sid not in seen:
                seen.add(sid)
                unique_schemes.append(s)

        # Search insurance
        ins_resp = requests.get(f"{ARTHSATHI_BACKEND}/api/insurance", params={"limit": 2}, timeout=10)
        insurance = ins_resp.json().get("data", []) if ins_resp.status_code == 200 else []

        # Build response
        if lang == "hi":
            response = f"आपकी जानकारी के आधार पर, ये योजनाएं आपके लिए हैं। "
        elif lang == "mr":
            response = f"तुमच्या माहितीनुसार, या योजना तुमच्यासाठी आहेत। "
        else:
            response = f"Based on your profile, here are the schemes for you. "

        # Top 2 schemes
        for i, s in enumerate(unique_schemes[:2], 1):
            name = s.get("name", {})
            scheme_name = (name.get("en") or name.get("hi")) if isinstance(name, dict) else str(name)
            desc = s.get("description", {})
            scheme_desc = (desc.get("en") or desc.get("hi", ""))[:100] if isinstance(desc, dict) else str(desc)[:100]
            response += f"{i}. {scheme_name}. {scheme_desc}. "

        # Top 1 insurance
        if insurance:
            ins = insurance[0]
            ins_name = ins.get("name", {})
            ins_name_str = (ins_name.get("en") or ins_name.get("hi")) if isinstance(ins_name, dict) else str(ins_name)
            if lang == "hi":
                response += f"बीमा योजना: {ins_name_str}. "
            else:
                response += f"Insurance: {ins_name_str}. "

        if lang == "hi":
            response += "अधिक जानकारी के लिए arthsathi.in पर जाएं।"
        elif lang == "mr":
            response += "अधिक माहितीसाठी arthsathi.in ला भेट द्या।"
        else:
            response += "Visit arthsathi.in for more information."

        return response

    except Exception as e:
        print(f"❌ Recommendation error: {e}")
        return {
            "hi": "PM Kisan योजना में किसानों को 6000 रुपये मिलते हैं। Ayushman Bharat में 5 लाख का मुफ्त इलाज मिलता है।",
            "en": "PM Kisan gives 6000 rupees to farmers. Ayushman Bharat gives free treatment up to 5 lakhs.",
            "mr": "PM Kisan योजनेत 6000 रुपये मिळतात. Ayushman Bharat मध्ये 5 लाखांचे मोफत उपचार."
        }.get(lang, "PM Kisan gives 6000 rupees to farmers.")


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
    current_q_index = 0
    profile = {}

    try:
        async for message in websocket.iter_text():
            data = json.loads(message)
            event = data.get("event")

            if event == "connected":
                print("✅ Exotel connection established")

            elif event == "start":
                stream_sid = (
                    data.get("streamSid") or
                    data.get("start", {}).get("streamSid") or
                    data.get("start", {}).get("stream_sid") or
                    "default_stream"
                )
                params = dict(websocket.query_params)
                lang = params.get("lang", "hi")
                print(f"🎙️ STREAM STARTED - SID: {stream_sid}, LANG: {lang}")

                SESSIONS[stream_sid] = {
                    "lang": lang,
                    "q_index": 0,
                    "profile": {},
                    "turn": 0
                }

                # Welcome + first question
                questions = QUESTIONS.get(lang, QUESTIONS["hi"])
                welcome = {
                    "hi": "नमस्ते! मैं आर्थसाथी हूं। मैं आपको सरकारी योजनाओं के बारे में बताऊंगा। पहले कुछ सवाल पूछूंगा।",
                    "en": "Hello! I am ArthSathi. I will help you find government schemes. I will ask you a few questions.",
                    "mr": "नमस्कार! मी आर्थसाथी आहे. मी तुम्हाला सरकारी योजना शोधण्यास मदत करेन. मी काही प्रश्न विचारेन."
                }.get(lang, "Hello! I am ArthSathi.")

                is_speaking = True
                await speak(websocket, welcome + " " + questions[0]["text"], lang, stream_sid)
                is_speaking = False
                await asyncio.sleep(1.0)
                audio_buffer.clear()

            elif event == "media":
                if is_processing or is_speaking or not stream_sid:
                    continue

                payload = data.get("media", {}).get("payload")
                if payload:
                    chunk = base64.b64decode(payload)
                    import struct
                    samples = struct.unpack(f"{len(chunk)//2}h", chunk)
                    energy = sum(abs(s) for s in samples) / len(samples)
                    if energy > 150:
                        audio_buffer.extend(chunk)

                if len(audio_buffer) >= 48000 and not is_processing:
                    is_processing = True
                    session = SESSIONS.get(stream_sid, {})
                    q_index = session.get("q_index", 0)
                    profile = session.get("profile", {})
                    turn = session.get("turn", 0) + 1
                    session["turn"] = turn

                    print(f"\n🔴 PROCESSING TURN {turn} - Q_INDEX: {q_index}")

                    # Save WAV
                    wav_path = f"caller_turn_{turn}.wav"
                    with wave.open(wav_path, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(8000)
                        wf.writeframes(bytes(audio_buffer))
                    audio_buffer.clear()

                    # Transcribe
                    user_text = transcribe_audio(wav_path, lang)
                    try:
                        os.remove(wav_path)
                    except:
                        pass

                    questions = QUESTIONS.get(lang, QUESTIONS["hi"])

                    if user_text:
                        # Extract answer for current question
                        current_q = questions[q_index]["key"]
                        print(f"📝 Answering: {current_q} = '{user_text}'")

                        if current_q == "age":
                            profile["age"] = extract_age(user_text)
                        elif current_q == "gender":
                            profile["gender"] = extract_gender(user_text)
                        elif current_q == "occupation":
                            profile["occupation"] = extract_occupation(user_text)
                        elif current_q == "income":
                            profile["income"] = extract_income(user_text)
                        elif current_q == "caste":
                            profile["caste"] = extract_caste(user_text)

                        session["profile"] = profile
                        q_index += 1
                        session["q_index"] = q_index

                        if q_index < len(questions):
                            # Ask next question
                            next_q = questions[q_index]["text"]
                            is_speaking = True
                            await speak(websocket, next_q, lang, stream_sid)
                            is_speaking = False
                            await asyncio.sleep(1.0)
                            audio_buffer.clear()
                        else:
                            # All questions answered — get recommendations
                            print(f"✅ Profile complete: {profile}")
                            if lang == "hi":
                                thanks = "धन्यवाद। आपकी जानकारी के आधार पर सरकारी योजनाएं खोज रहा हूं। कृपया एक क्षण रुकें।"
                            elif lang == "mr":
                                thanks = "धन्यवाद. तुमच्या माहितीनुसार योजना शोधत आहे. एक क्षण थांबा."
                            else:
                                thanks = "Thank you. Finding schemes based on your profile. Please wait a moment."

                            is_speaking = True
                            await speak(websocket, thanks, lang, stream_sid)
                            is_speaking = False

                            # Get recommendations
                            result = get_recommendations(profile, lang)

                            is_speaking = True
                            await speak(websocket, result, lang, stream_sid)
                            is_speaking = False

                            # Goodbye
                            bye = {
                                "hi": "धन्यवाद। अधिक जानकारी के लिए arthsathi.in पर जाएं। नमस्ते।",
                                "en": "Thank you. Visit arthsathi.in for more information. Goodbye.",
                                "mr": "धन्यवाद. arthsathi.in ला भेट द्या. नमस्कार."
                            }.get(lang, "Thank you. Goodbye.")

                            await speak(websocket, bye, lang, stream_sid)

                            # Reset for another round
                            session["q_index"] = 0
                            session["profile"] = {}
                            audio_buffer.clear()
                    else:
                        # Didn't understand — repeat question
                        retry = {
                            "hi": "मुझे समझ नहीं आया। कृपया फिर से बोलें। " + questions[q_index]["text"],
                            "en": "I didn't understand. Please say again. " + questions[q_index]["text"],
                            "mr": "मला समजले नाही. पुन्हा सांगा. " + questions[q_index]["text"]
                        }.get(lang, questions[q_index]["text"])

                        is_speaking = True
                        await speak(websocket, retry, lang, stream_sid)
                        is_speaking = False
                        await asyncio.sleep(1.0)
                        audio_buffer.clear()

                    is_processing = False

            elif event == "stop":
                print("🛑 STREAM STOPPED")
                if stream_sid in SESSIONS:
                    del SESSIONS[stream_sid]

    except WebSocketDisconnect:
        print("🔴 EXOTEL DISCONNECTED")
        if stream_sid and stream_sid in SESSIONS:
            del SESSIONS[stream_sid]
    except Exception as e:
        print(f"❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


@app.get("/")
def health():
    return {"status": "ArthSathi IVR running", "sessions": len(SESSIONS)}
