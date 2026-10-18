#!/usr/bin/env python3
"""
ArthSathi — Offline Translation Script (IndicTrans2)

Uses AI4Bharat's IndicTrans2 model for English → Indian languages.
First run downloads the model (~200MB). Subsequent calls are fast.

Usage:
    python translate.py "Hello world" hi
    python translate.py "Government scheme" mr
"""

import sys
import os

# Suppress TensorFlow warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['TRANSFORMERS_NO_ADVISORY_WARNINGS'] = '1'

def translate_simple(text, target_lang):
    """
    Fallback: Simple word-by-word dictionary translation.
    Used when IndicTrans2 is not installed or fails.
    """
    # Common government/scheme vocabulary
    DICT = {
        'hi': {
            'scheme': 'योजना', 'government': 'सरकार', 'insurance': 'बीमा',
            'farmer': 'किसान', 'health': 'स्वास्थ्य', 'education': 'शिक्षा',
            'loan': 'ऋण', 'benefit': 'लाभ', 'apply': 'आवेदन', 'for': 'के लिए',
            'and': 'और', 'the': '', 'a': '', 'of': 'का',
        },
        'mr': {
            'scheme': 'योजना', 'government': 'सरकार', 'insurance': 'विमा',
            'farmer': 'शेतकरी', 'health': 'आरोग्य', 'education': 'शिक्षण',
        },
    }
    
    words = text.lower().split()
    lang_dict = DICT.get(target_lang, {})
    translated = [lang_dict.get(w, w) for w in words]
    return ' '.join(translated).strip()


def translate_indictrans(text, target_lang):
    """
    High-quality translation using IndicTrans2 model.
    Downloads model on first run (~200MB).
    """
    try:
        from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
        
        # Model mapping
        MODELS = {
            'hi': 'ai4bharat/indictrans2-en-indic-dist-200M',
            'mr': 'ai4bharat/indictrans2-en-indic-dist-200M',
            'ta': 'ai4bharat/indictrans2-en-indic-dist-200M',
            'te': 'ai4bharat/indictrans2-en-indic-dist-200M',
            'bn': 'ai4bharat/indictrans2-en-indic-dist-200M',
        }
        
        model_name = MODELS.get(target_lang)
        if not model_name:
            return translate_simple(text, target_lang)
        
        # Cache directory
        cache_dir = os.path.join(os.path.dirname(__file__), '../../.model-cache')
        os.makedirs(cache_dir, exist_ok=True)
        
        tokenizer = AutoTokenizer.from_pretrained(model_name, cache_dir=cache_dir)
        model = AutoModelForSeq2SeqLM.from_pretrained(model_name, cache_dir=cache_dir)
        
        # Prepare input with language tag
        inputs = tokenizer(f"<2{target_lang}> {text}", return_tensors="pt", padding=True)
        
        # Generate translation
        outputs = model.generate(**inputs, max_length=256, num_beams=4)
        translated = tokenizer.decode(outputs[0], skip_special_tokens=True)
        
        return translated
        
    except ImportError:
        # IndicTrans2 not installed — use fallback
        return translate_simple(text, target_lang)
    except Exception as e:
        print(f"Translation error: {e}", file=sys.stderr)
        return translate_simple(text, target_lang)


def main():
    if len(sys.argv) < 3:
        print("Usage: translate.py <text> <target_lang>", file=sys.stderr)
        sys.exit(1)
    
    text = sys.argv[1]
    target_lang = sys.argv[2]
    
    # Quick validation
    if target_lang not in ['hi', 'mr', 'ta', 'te', 'bn']:
        print(text)  # Return original for unsupported languages
        sys.exit(0)
    
    # Translate
    translated = translate_indictrans(text, target_lang)
    print(translated)
    sys.exit(0)


if __name__ == '__main__':
    main()
