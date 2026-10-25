from gtts import gTTS
import os

output_dir = os.path.join(os.path.dirname(__file__), 'uploads', 'ivr_audio')
os.makedirs(output_dir, exist_ok=True)

audio_files = [
    {
        'filename': 'welcome.mp3',
        'text': 'ArthSathi mein aapka swagat hai. Hindi ke liye ek dabaiye. Press two for English. Marathi sathi teen daaba.',
        'lang': 'hi',
    },
    {
        'filename': 'age_hi.mp3',
        'text': 'Aapki umar kitni hai? Kripaya do ank mein dabaiye. Jaise 35 ke liye, 3 aur 5 dabaiye.',
        'lang': 'hi',
    },
    {
        'filename': 'age_en.mp3',
        'text': 'How old are you? Please enter your age in two digits. For example, press 3 and 5 for age 35.',
        'lang': 'en',
    },
    {
        'filename': 'age_mr.mp3',
        'text': 'Tumchi vay kiti ahe? Kripaya do ankde daaba. Udaharanarth, 35 saathi 3 ani 5 daaba.',
        'lang': 'mr',
    },
    {
        'filename': 'gender_hi.mp3',
        'text': 'Aapka ling kya hai? Purush ke liye 1 dabaiye. Mahila ke liye 2 dabaiye. Anya ke liye 3 dabaiye.',
        'lang': 'hi',
    },
    {
        'filename': 'gender_en.mp3',
        'text': 'What is your gender? Press 1 for male. Press 2 for female. Press 3 for other.',
        'lang': 'en',
    },
    {
        'filename': 'caste_hi.mp3',
        'text': 'Aapki jaati shreni kya hai? Samanya ke liye 1. OBC ke liye 2. SC ke liye 3. ST ke liye 4. Anya ke liye 5.',
        'lang': 'hi',
    },
    {
        'filename': 'occupation_hi.mp3',
        'text': 'Aap kya kaam karte hain? Kisan ke liye 1. Khet mazdoor ke liye 2. Dihadi mazdoor ke liye 3. Swa-rozgar ke liye 4. Nirman mazdoor ke liye 5. Anya ke liye 6.',
        'lang': 'hi',
    },
    {
        'filename': 'income_hi.mp3',
        'text': 'Aap har mahine kitna kamate hain rupyon mein? Kripaya sirf ank dabaiye. Jaise 5000 ke liye, 5-0-0-0 dabaiye.',
        'lang': 'hi',
    },
    {
        'filename': 'results_hi.mp3',
        'text': 'Aapki jankari ke aadhaar par, hum aapke liye sarkari yojanaen dhundh rahe hain. Kripaya pratiksha karein.',
        'lang': 'hi',
    },
    {
        'filename': 'no_results_hi.mp3',
        'text': 'Aapke profile ke liye koi yojana nahi mili. Adhik jankari ke liye arthsathi dot in par jayen.',
        'lang': 'hi',
    },
    {
        'filename': 'closing_hi.mp3',
        'text': 'Adhik jankari ke liye arthsathi dot in par jayen ya dobara call karein. Dhanyawad. Jai Hind.',
        'lang': 'hi',
    },
    {
        'filename': 'invalid_hi.mp3',
        'text': 'Galat input. Kripaya dobara dabaiye.',
        'lang': 'hi',
    },
]

for item in audio_files:
    path = os.path.join(output_dir, item['filename'])
    tts = gTTS(text=item['text'], lang=item['lang'], slow=False)
    tts.save(path)
    print(f"Created: {item['filename']}")

print(f"\nAll audio files saved to: {output_dir}")
print("Upload these to Exotel Audio Library at: https://my.exotel.com/frcrce3/settings/site/audio_library")
