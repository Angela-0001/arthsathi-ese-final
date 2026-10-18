"""
Answer extraction utilities for multi-turn IVR conversations.
Extracts structured data from mixed Hindi/English/Marathi/Punjabi user responses.
"""

import re
from typing import Optional, List


# Number word mappings (Hindi and English)
NUMBER_WORDS = {
    # Hindi numbers
    "ek": 1, "एक": 1,
    "do": 2, "दो": 2,
    "teen": 3, "तीन": 3,
    "char": 4, "चार": 4,
    "paanch": 5, "पांच": 5, "panch": 5,
    "chah": 6, "छह": 6, "chhah": 6,
    "saat": 7, "सात": 7,
    "aath": 8, "आठ": 8,
    "nau": 9, "नौ": 9,
    "das": 10, "दस": 10,
    "bees": 20, "बीस": 20,
    "tees": 30, "तीस": 30,
    "chaalis": 40, "चालीस": 40,
    "pachaas": 50, "पचास": 50,
    "saath": 60, "साठ": 60,
    "sattar": 70, "सत्तर": 70,
    "assi": 80, "अस्सी": 80,
    "nabbe": 90, "नब्बे": 90,
    "sau": 100, "सौ": 100,
    "hazar": 1000, "हज़ार": 1000, "hajar": 1000,
    "lakh": 100000, "लाख": 100000,
    "crore": 10000000, "करोड़": 10000000,
    
    # English numbers
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "thousand": 1000, "million": 1000000
}


# Indian state mappings (various languages to canonical English name)
STATE_MAPPINGS = {
    # Punjab
    "punjab": "Punjab", "panjab": "Punjab", "ਪੰਜਾਬ": "Punjab", "पंजाब": "Punjab",
    
    # Haryana
    "haryana": "Haryana", "हरियाणा": "Haryana", "ਹਰਿਆਣਾ": "Haryana",
    
    # Delhi
    "delhi": "Delhi", "dilli": "Delhi", "दिल्ली": "Delhi", "ਦਿੱਲੀ": "Delhi",
    
    # Uttar Pradesh
    "uttar pradesh": "Uttar Pradesh", "up": "Uttar Pradesh", "उत्तर प्रदेश": "Uttar Pradesh",
    
    # Madhya Pradesh
    "madhya pradesh": "Madhya Pradesh", "mp": "Madhya Pradesh", "मध्य प्रदेश": "Madhya Pradesh",
    
    # Rajasthan
    "rajasthan": "Rajasthan", "राजस्थान": "Rajasthan", "ਰਾਜਸਥਾਨ": "Rajasthan",
    
    # Gujarat
    "gujarat": "Gujarat", "gujrat": "Gujarat", "गुजरात": "Gujarat",
    
    # Maharashtra
    "maharashtra": "Maharashtra", "महाराष्ट्र": "Maharashtra", "maha": "Maharashtra",
    
    # Bihar
    "bihar": "Bihar", "बिहार": "Bihar",
    
    # West Bengal
    "west bengal": "West Bengal", "bengal": "West Bengal", "पश्चिम बंगाल": "West Bengal",
    
    # Jharkhand
    "jharkhand": "Jharkhand", "झारखंड": "Jharkhand",
    
    # Odisha
    "odisha": "Odisha", "orissa": "Odisha", "ओडिशा": "Odisha",
    
    # Chhattisgarh
    "chhattisgarh": "Chhattisgarh", "छत्तीसगढ़": "Chhattisgarh",
    
    # Andhra Pradesh
    "andhra pradesh": "Andhra Pradesh", "ap": "Andhra Pradesh", "आंध्र प्रदेश": "Andhra Pradesh",
    
    # Telangana
    "telangana": "Telangana", "तेलंगाना": "Telangana",
    
    # Karnataka
    "karnataka": "Karnataka", "कर्नाटक": "Karnataka",
    
    # Tamil Nadu
    "tamil nadu": "Tamil Nadu", "tamilnadu": "Tamil Nadu", "तमिल नाडु": "Tamil Nadu",
    
    # Kerala
    "kerala": "Kerala", "केरल": "Kerala",
    
    # Goa
    "goa": "Goa", "गोवा": "Goa",
    
    # Assam
    "assam": "Assam", "असम": "Assam",
    
    # Himachal Pradesh
    "himachal pradesh": "Himachal Pradesh", "hp": "Himachal Pradesh", "हिमाचल प्रदेश": "Himachal Pradesh",
    
    # Uttarakhand
    "uttarakhand": "Uttarakhand", "उत्तराखंड": "Uttarakhand",
    
    # Jammu and Kashmir
    "jammu kashmir": "Jammu and Kashmir", "jk": "Jammu and Kashmir", "जम्मू कश्मीर": "Jammu and Kashmir",
    
    # Other states
    "manipur": "Manipur", "meghalaya": "Meghalaya", "mizoram": "Mizoram",
    "nagaland": "Nagaland", "sikkim": "Sikkim", "tripura": "Tripura", "arunachal pradesh": "Arunachal Pradesh"
}


def extract_number(text: str) -> Optional[int]:
    """
    Generic number extraction from text.
    Tries regex first, then word parsing.
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    # Try regex for digits first (fastest)
    digit_match = re.search(r'\b(\d+)\b', text)
    if digit_match:
        try:
            return int(digit_match.group(1))
        except:
            pass
    
    # Try word parsing
    result = 0
    for word, value in NUMBER_WORDS.items():
        if word in text:
            result += value
    
    return result if result > 0 else None


def extract_age(text: str) -> Optional[int]:
    """
    Extract age from text.
    Handles: "42 saal", "forty two", "42", "42 years", Hindi numerals
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    # Remove common age-related words
    text = re.sub(r'\b(saal|year|years|varsh|वर्ष|साल)\b', '', text)
    
    # Try extraction
    age = extract_number(text)
    
    # Validate age range
    if age and 0 <= age <= 120:
        return age
    
    return None


def extract_income(text: str) -> Optional[int]:
    """
    Extract income/amount from text.
    Handles: "do lakh" (200000), "2 lakh", "200000", "teen lakh pachas hazar" (350000)
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    # Try direct number first
    direct_match = re.search(r'\b(\d+)\b', text)
    if direct_match:
        try:
            num = int(direct_match.group(1))
            # If it's a reasonable income, return it
            if num >= 1000:
                return num
        except:
            pass
    
    # Parse word-based amounts
    amount = 0
    
    # Check for lakhs
    lakh_patterns = [
        (r'(\d+\.?\d*)\s*(?:lakh|लाख)', lambda m: int(float(m.group(1)) * 100000)),
        (r'(ek|एक)\s*(?:lakh|लाख)', lambda m: 100000),
        (r'(do|दो)\s*(?:lakh|लाख)', lambda m: 200000),
        (r'(teen|तीन)\s*(?:lakh|लाख)', lambda m: 300000),
        (r'(char|चार)\s*(?:lakh|लाख)', lambda m: 400000),
        (r'(paanch|panch|पांच)\s*(?:lakh|लाख)', lambda m: 500000),
    ]
    
    for pattern, converter in lakh_patterns:
        match = re.search(pattern, text)
        if match:
            amount += converter(match)
    
    # Check for thousands (hazar)
    hazar_patterns = [
        (r'(\d+)\s*(?:hazar|hajar|हज़ार)', lambda m: int(m.group(1)) * 1000),
        (r'(pachas|पचास)\s*(?:hazar|hajar|हज़ार)', lambda m: 50000),
        (r'(das|दस)\s*(?:hazar|hajar|हज़ार)', lambda m: 10000),
    ]
    
    for pattern, converter in hazar_patterns:
        match = re.search(pattern, text)
        if match:
            amount += converter(match)
    
    # Check for crores
    crore_patterns = [
        (r'(\d+\.?\d*)\s*(?:crore|करोड़)', lambda m: int(float(m.group(1)) * 10000000)),
        (r'(ek|एक)\s*(?:crore|करोड़)', lambda m: 10000000),
    ]
    
    for pattern, converter in crore_patterns:
        match = re.search(pattern, text)
        if match:
            amount += converter(match)
    
    return amount if amount > 0 else None


def extract_state(text: str) -> Optional[str]:
    """
    Extract Indian state name from text.
    Returns normalized English state name.
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    # Try exact match first
    for key, canonical in STATE_MAPPINGS.items():
        if key in text:
            return canonical
    
    # Try word boundaries
    for key, canonical in STATE_MAPPINGS.items():
        if re.search(r'\b' + re.escape(key) + r'\b', text):
            return canonical
    
    return None


def extract_choice(text: str, options: List[str]) -> Optional[str]:
    """
    Extract choice from text by fuzzy matching against options list.
    Supports synonyms for common choices.
    Returns matched option or None.
    """
    if not text or not options:
        return None
    
    text = text.lower().strip()
    
    # Synonym mappings for common choices
    synonyms = {
        "vehicle": ["car", "bike", "gaadi", "gadi", "motor", "motorcycle", "scooter", "truck", "auto"],
        "health": ["medical", "hospital", "ilaaj", "इलाज", "doctor", "clinic"],
        "life": ["jeevan", "जीवन", "zindagi", "ज़िंदगी"],
        "accident": ["durghatna", "दुर्घटना", "mishap"],
        "other": ["anya", "अन्य", "kuch aur", "कुछ और"],
        "rural": ["gaon", "गांव", "village", "pind", "पिंड", "grameen", "ग्रामीण"],
        "urban": ["sheher", "शहर", "city", "shahar", "nagar", "नगर"],
        "male": ["purush", "पुरुष", "man", "ladka", "लड़का", "mard", "मर्द"],
        "female": ["mahila", "महिला", "woman", "aurat", "औरत", "ladki", "लड़की", "stri", "स्त्री"]
    }
    
    # Try exact match first
    for option in options:
        if option.lower() == text:
            return option
    
    # Try synonym expansion
    for option in options:
        option_lower = option.lower()
        # Check if text matches any synonym for this option
        if option_lower in synonyms:
            for synonym in synonyms[option_lower]:
                if synonym in text or text in synonym:
                    return option
    
    # Try substring match
    for option in options:
        if option.lower() in text or text in option.lower():
            return option
    
    return None


def extract_gender(text: str) -> Optional[str]:
    """
    Extract gender from text.
    Returns: "male", "female", or "other"
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    # Male patterns
    male_keywords = ["male", "purush", "पुरुष", "man", "ladka", "लड़का", "मर्द", "mard", "पुरूष"]
    if any(kw in text for kw in male_keywords):
        return "male"
    
    # Female patterns
    female_keywords = ["female", "mahila", "महिला", "woman", "aurat", "औरत", "ladki", "लड़की", "स्त्री", "stri"]
    if any(kw in text for kw in female_keywords):
        return "female"
    
    # Other
    other_keywords = ["other", "anya", "अन्य", "transgender"]
    if any(kw in text for kw in other_keywords):
        return "other"
    
    return None


def extract_rural_urban(text: str) -> Optional[str]:
    """
    Extract rural or urban from text.
    Returns: "rural" or "urban"
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    # Rural patterns
    rural_keywords = ["rural", "gaon", "गांव", "village", "pind", "पिंड", "ग्रामीण", "grameen"]
    if any(kw in text for kw in rural_keywords):
        return "rural"
    
    # Urban patterns
    urban_keywords = ["urban", "sheher", "शहर", "city", "shahar", "नगर", "nagar"]
    if any(kw in text for kw in urban_keywords):
        return "urban"
    
    return None


def extract_social_category(text: str) -> Optional[str]:
    """
    Extract social category from text.
    Returns normalized category: SC, ST, OBC, General
    """
    if not text:
        return None
    
    text = text.lower().strip()
    
    if "sc" in text or "scheduled caste" in text or "अनुसूचित जाति" in text:
        return "SC"
    
    if "st" in text or "scheduled tribe" in text or "अनुसूचित जनजाति" in text:
        return "ST"
    
    if "obc" in text or "other backward" in text or "पिछड़ा" in text or "pichda" in text:
        return "OBC"
    
    if "general" in text or "सामान्य" in text or "samanya" in text:
        return "General"
    
    if "bpl" in text or "below poverty" in text or "गरीबी" in text:
        return "BPL"
    
    return None
