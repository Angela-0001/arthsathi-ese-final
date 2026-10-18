"""
Dynamic multilingual question generator.

Question source:
    lang/hi.json
    lang/en.json
    lang/mr.json
    lang/pa.json

Fallback:
    data/field_questions.json
"""

import json
import os
from typing import Dict, Optional, List


# =========================================================
# CACHE
# =========================================================

_language_questions_cache: Dict[str, Dict] = {}
_field_questions_cache: Optional[Dict] = None


# =========================================================
# FIELD → JSON KEY MAPPING
# =========================================================
#
# Existing conversation fields
#          ↓
# New language JSON key
#
# =========================================================

FIELD_TO_JSON_KEY = {

    "age": "q_age",

    "gender": "q_gender",

    "state": "q_state",

    "district": "q_district",

    "social_category": "q_caste",

    "occupation": "q_occupation",

    "annual_income": "q_income",

    "family_members": "q_family",

    "bank_account": "q_bank",

    "bpl_status": "q_bpl",

}


# =========================================================
# LOAD LANGUAGE JSON
# =========================================================

def load_language_questions(language: str) -> Dict:

    global _language_questions_cache

    # Normalize language
    language = language.lower()

    if language in _language_questions_cache:
        return _language_questions_cache[language]

    current_dir = os.path.dirname(
        os.path.abspath(__file__)
    )

    project_root = os.path.dirname(
        current_dir
    )

    # hi → hi.json
    language_file_map = {
        "hi": "hi.json",
        "en": "en.json",
        "mr": "mr.json",
        "pa": "pa.json"
    }

    file_name = language_file_map.get(
        language,
        "hi.json"
    )

    language_path = os.path.join(
        project_root,
        "lang",
        file_name
    )

    if os.path.exists(language_path):

        try:

            with open(
                language_path,
                "r",
                encoding="utf-8"
            ) as f:

                data = json.load(f)

            _language_questions_cache[
                language
            ] = data

            print(
                f"✅ Loaded language JSON: {language_path}"
            )

            return data

        except Exception as e:

            print(
                f"❌ Error loading {language_path}: {e}"
            )

    else:

        print(
            f"⚠️ Language file not found: {language_path}"
        )

    _language_questions_cache[
        language
    ] = {}

    return {}


# =========================================================
# LOAD OLD FIELD QUESTIONS
# =========================================================

def load_field_questions() -> Dict:

    global _field_questions_cache

    if _field_questions_cache is not None:
        return _field_questions_cache

    current_dir = os.path.dirname(
        os.path.abspath(__file__)
    )

    project_root = os.path.dirname(
        current_dir
    )

    questions_path = os.path.join(
        project_root,
        "data",
        "field_questions.json"
    )

    if os.path.exists(questions_path):

        try:

            with open(
                questions_path,
                "r",
                encoding="utf-8"
            ) as f:

                _field_questions_cache = json.load(f)

            print(
                f"✅ Loaded "
                f"{len(_field_questions_cache)} "
                f"fallback field questions"
            )

        except Exception as e:

            print(
                f"❌ Error loading field_questions.json: {e}"
            )

            _field_questions_cache = {}

    else:

        print(
            "⚠️ data/field_questions.json not found"
        )

        _field_questions_cache = {}

    return _field_questions_cache


# =========================================================
# GENERATE QUESTION
# =========================================================

def generate_question(
    field_name: str,
    language: str,
    context: Dict = None
) -> str:

    """
    Generate a question using the new language JSON.

    Example:

        generate_question("age", "hi")
        → आपकी उम्र कितनी है?

        generate_question("age", "en")
        → How old are you?
    """

    language = language.lower()

    # -----------------------------------------------------
    # 1. Try NEW LANGUAGE JSON
    # -----------------------------------------------------

    language_data = load_language_questions(
        language
    )

    json_key = FIELD_TO_JSON_KEY.get(
        field_name
    )

    if json_key:

        question = language_data.get(
            json_key
        )

        if question:

            print(
                f"✅ JSON question: "
                f"{field_name} → {json_key} → {language}"
            )

            return question


    # -----------------------------------------------------
    # 2. Fallback to old field_questions.json
    # -----------------------------------------------------

    questions = load_field_questions()

    field_questions = questions.get(
        field_name
    )

    if field_questions:

        question_text = field_questions.get(
            language
        )

        if question_text:
            return question_text

        # Hindi fallback
        question_text = field_questions.get(
            "hi"
        )

        if question_text:
            return question_text


    # -----------------------------------------------------
    # 3. Final fallback
    # -----------------------------------------------------

    print(
        f"⚠️ No question found for field: "
        f"{field_name}"
    )

    return f"Please provide {field_name}."


# =========================================================
# RETRY QUESTION
# =========================================================

def get_retry_question(
    field_name: str,
    language: str
) -> str:

    retry_messages = {

        "hi":
            "माफ़ कीजिए, मैं समझ नहीं पाया।",

        "en":
            "Sorry, I did not understand.",

        "mr":
            "माफ करा, मला समजले नाही.",

        "pa":
            "ਮਾਫ਼ ਕਰਨਾ, ਮੈਂ ਸਮਝ ਨਹੀਂ ਸਕਿਆ।"
    }

    retry_msg = retry_messages.get(
        language,
        retry_messages["hi"]
    )

    original_question = generate_question(
        field_name,
        language
    )

    return (
        f"{retry_msg} "
        f"{original_question}"
    )


# =========================================================
# NEXT MISSING FIELD
# =========================================================

def get_next_missing_field(
    collected_fields: Dict,
    required_fields: List[str]
) -> Optional[str]:

    """
    Return the first required field
    that has not been collected.
    """

    for field in required_fields:

        if (
            field not in collected_fields
            or collected_fields[field] is None
            or collected_fields[field] == ""
        ):

            return field

    return None