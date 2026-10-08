"""
ArthSathi — Eligibility Parser (standalone, re-usable)
=======================================================

Parses myscheme.gov.in's rich-text eligibility criteria dict into
structured fields for the DB. Called by myscheme_scraper.py.

The eligibilityCriteria field is a dict like:
{
  "ageGroup": {...} or "18-40 years",
  "incomeGroup": {...} or "Below 1 Lakh",
  "caste": [...],
  "gender": "Female",
  "maritalStatus": ...,
  "residence": ...,
  "disability": ...,
  "targetBeneficiary": [...],
  ... other structured keys
}

OR it could be a list of rich-text nodes containing bullet points.
We handle both formats.
"""

import re
import json
from typing import Any, Optional


def flatten_rich_text(obj: Any, depth: int = 0) -> str:
    """
    Recursively extract all text from editor.js / Slate rich text nodes.
    Handles: string, list, dict with text/children/content keys.
    """
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj.strip()
    if isinstance(obj, (int, float, bool)):
        return str(obj)
    if isinstance(obj, list):
        parts = []
        for item in obj:
            t = flatten_rich_text(item, depth + 1)
            if t:
                parts.append(t)
        return " ".join(parts)
    if isinstance(obj, dict):
        # Direct text field
        if "text" in obj and isinstance(obj["text"], str):
            return obj["text"].strip()
        # Nested children
        if "children" in obj:
            return flatten_rich_text(obj["children"], depth + 1)
        if "content" in obj:
            return flatten_rich_text(obj["content"], depth + 1)
        # Value field (used in select/option nodes)
        if "value" in obj and isinstance(obj["value"], str):
            return obj["value"].strip()
        if "label" in obj and isinstance(obj["label"], str):
            return obj["label"].strip()
        # Try all string values
        parts = []
        for v in obj.values():
            if isinstance(v, str) and v.strip():
                parts.append(v.strip())
            elif isinstance(v, (list, dict)):
                t = flatten_rich_text(v, depth + 1)
                if t:
                    parts.append(t)
        return " ".join(parts)
    return ""


def parse_age_from_text(text: str) -> tuple:
    """Extract (min_age, max_age) from any text containing age mentions."""
    text = text.lower().strip()
    if not text:
        return None, None

    # "X-Y years" or "X to Y years" or "X–Y"
    m = re.search(r'\b(\d{1,2})\s*(?:to|[-–])\s*(\d{1,2})\s*(?:year|yr|age)?', text)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if 1 <= a < b <= 100:
            return a, b

    # "above/minimum/at least X"
    m_above = re.search(
        r'(?:above|over|minimum|at least|min\.?|>=?|more than)\s*(\d{1,3})\s*(?:year|yr)?',
        text
    )
    # "below/up to/maximum/under X"
    m_below = re.search(
        r'(?:below|under|up to|upto|maximum|max\.?|<=?|less than|not more than)\s*(\d{1,3})\s*(?:year|yr)?',
        text
    )

    min_age = int(m_above.group(1)) if m_above else None
    max_age = int(m_below.group(1)) if m_below else None

    # Sanity: ages must be plausible
    if min_age and (min_age < 1 or min_age > 80):
        min_age = None
    if max_age and (max_age < 5 or max_age > 120):
        max_age = None

    return min_age, max_age


def parse_income_from_text(text: str) -> Optional[float]:
    """Extract max annual income (INR) from any text."""
    text = text.lower().strip()
    if not text:
        return None

    # X.Y lakh(s)/lac(s)
    m = re.search(r'(\d+(?:\.\d+)?)\s*(?:lakh|lac|lakhs|lacs)\b', text)
    if m:
        return float(m.group(1)) * 100_000

    # X,YY,ZZZ format
    m = re.search(r'(?:rs\.?|₹|inr\.?)\s*([\d,]+)', text)
    if m:
        val = float(m.group(1).replace(",", ""))
        if 1000 < val < 1_000_000_000:
            return val

    # "below poverty line" / "BPL" implies roughly below 1.2 lakh rural
    if re.search(r'\bbpl\b|below poverty', text):
        return 120_000.0

    return None


def parse_castes_from_obj(obj: Any) -> list:
    """
    Extract caste categories from a caste field (list, string, or dict).
    Maps to our enum: sc, st, obc, ews, general
    """
    text = flatten_rich_text(obj).lower()
    castes = []
    if re.search(r'\bsc\b|scheduled caste|dalit', text):
        castes.append("sc")
    if re.search(r'\bst\b|scheduled tribe|tribal|adivasi', text):
        castes.append("st")
    if re.search(r'\bobc\b|other backward', text):
        castes.append("obc")
    if re.search(r'\bews\b|economically weaker', text):
        castes.append("ews")
    if re.search(r'\bgeneral\b|unreserved|open category', text):
        castes.append("general")
    return castes


def parse_genders_from_obj(obj: Any) -> list:
    """Map gender field to our enum values (empty = no restriction)."""
    text = flatten_rich_text(obj).lower()
    genders = []
    if re.search(r'\bmale\b|\bmen\b|\bman\b|\bboy\b|\bfather\b', text):
        genders.append("male")
    if re.search(r'\bfemale\b|\bwomen\b|\bwoman\b|\bgirl\b|\bmother\b|\bmahila\b', text):
        genders.append("female")
    if re.search(r'transgender|third gender|kinnar|hijra', text):
        genders.append("transgender")
    # If both male and female mentioned, no restriction (or "all")
    if "all" in text or ("male" in text and "female" in text and len(genders) == 2):
        return []
    return genders


def parse_occupations_from_obj(obj: Any) -> list:
    """Map beneficiary/occupation field to our enum values."""
    text = flatten_rich_text(obj).lower()
    occs = []
    occ_map = [
        (["farmer", "kisan", "cultivator", "kisaan"], ["farmer", "marginal_farmer"]),
        (["farm labour", "agricultural labour", "farm labor", "agricultural worker"], ["farm_laborer"]),
        (["fisherman", "fisher", "fishing community"], ["fisherman"]),
        (["weaver"], ["weaver"]),
        (["potter"], ["potter"]),
        (["artisan", "craftsman", "craftsperson", "handicraft"], ["artisan"]),
        (["street vendor", "hawker", "vending"], ["street_vendor"]),
        (["construction worker", "building worker"], ["construction_worker"]),
        (["domestic worker", "house help"], ["domestic_worker"]),
        (["daily wage", "casual labour", "unorganised"], ["daily_wage"]),
        (["self.employed", "small business", "entrepreneur", "vendor"], ["self_employed"]),
        (["small trader", "trader"], ["small_trader"]),
        (["student"], ["student"]),
        (["teacher", "faculty"], ["teacher"]),
        (["unemployed", "job seeker"], ["unemployed"]),
        (["woman", "women", "widow", "housewife", "homemaker"], ["homemaker"]),
    ]
    seen = set()
    for keywords, enum_vals in occ_map:
        if any(kw in text for kw in keywords):
            for v in enum_vals:
                if v not in seen:
                    occs.append(v)
                    seen.add(v)
    return occs[:8]  # limit


def parse_ration_cards_from_text(text: str) -> list:
    """Extract eligible ration card types from eligibility text."""
    text = text.lower()
    cards = []
    if re.search(r'\baay\b|antyodaya', text):
        cards.append("aay")
    if re.search(r'\bphh\b|priority household|\bbpl\b|below poverty', text):
        cards.append("phh")
    if re.search(r'\bnphh\b|non.priority|\bapl\b|above poverty', text):
        cards.append("nphh")
    if re.search(r'annapurna', text):
        cards.append("annapurna")
    return cards


def parse_residence_from_text(text: str) -> list:
    """Extract residence restriction."""
    text = text.lower()
    if "rural" in text and "urban" in text:
        return ["rural", "urban"]
    if "rural" in text:
        return ["rural"]
    if "urban" in text:
        return ["urban"]
    return []


def parse_eligibility_criteria(ec_obj: Any) -> dict:
    """
    Main parser. Accepts the eligibilityCriteria field (dict, list, or string)
    and returns a structured dict with parsed fields.
    
    Returns:
    {
      min_age, max_age,
      max_annual_income,
      eligible_genders: [],
      eligible_castes: [],
      eligible_occupations: [],
      eligible_ration_cards: [],
      eligible_residence: [],
      requires_bank_account: bool,
      requires_aadhaar: bool,
      requires_bpl: bool,
      requires_disability: bool,
      requires_widow: bool,
      requires_student: bool,
      requires_farmer: bool,
      disability_min_percent: int|None,
      raw_text: str,  # full extracted text
      parse_confidence: float,
    }
    """
    result = {
        "min_age": None, "max_age": None,
        "max_annual_income": None,
        "eligible_genders": [], "eligible_castes": [],
        "eligible_occupations": [], "eligible_ration_cards": [],
        "eligible_residence": [],
        "requires_bank_account": False, "requires_aadhaar": False,
        "requires_bpl": False, "requires_disability": False,
        "requires_widow": False, "requires_student": False,
        "requires_farmer": False,
        "disability_min_percent": None,
        "raw_text": "", "parse_confidence": 0.0,
    }

    if not ec_obj:
        return result

    # ── Case 1: dict with structured keys (most myscheme schemes) ──────────
    if isinstance(ec_obj, dict):
        raw_parts = []

        # Handle myscheme's common format: {"eligibilityDescription": [...rich text...], "ageGroup": ..., ...}
        # Extract the plain text description first
        elig_desc = ec_obj.get("eligibilityDescription") or ec_obj.get("eligibility") or []
        if elig_desc:
            desc_text = flatten_rich_text(elig_desc)
            if desc_text:
                raw_parts.append(desc_text)

        # Age
        age_val = ec_obj.get("ageGroup") or ec_obj.get("age") or ec_obj.get("minAge") or ""
        age_text = flatten_rich_text(age_val)
        if age_text:
            raw_parts.append("Age: " + age_text)
            result["min_age"], result["max_age"] = parse_age_from_text(age_text)

        # Income
        income_val = ec_obj.get("incomeGroup") or ec_obj.get("income") or ec_obj.get("annualIncome") or ""
        income_text = flatten_rich_text(income_val)
        if income_text:
            raw_parts.append("Income: " + income_text)
            result["max_annual_income"] = parse_income_from_text(income_text)

        # Caste
        caste_val = ec_obj.get("caste") or ec_obj.get("casteCategory") or []
        result["eligible_castes"] = parse_castes_from_obj(caste_val)
        if caste_val:
            raw_parts.append("Caste: " + flatten_rich_text(caste_val))

        # Gender
        gender_val = ec_obj.get("gender") or ec_obj.get("sex") or ""
        result["eligible_genders"] = parse_genders_from_obj(gender_val)
        if gender_val:
            raw_parts.append("Gender: " + flatten_rich_text(gender_val))

        # Target beneficiaries / occupation
        beneficiary_val = (ec_obj.get("targetBeneficiary") or
                           ec_obj.get("beneficiary") or
                           ec_obj.get("schemeFor") or [])
        occ_text = flatten_rich_text(beneficiary_val)
        if occ_text:
            raw_parts.append("Beneficiary: " + occ_text)
            result["eligible_occupations"] = parse_occupations_from_obj(occ_text)

        # Marital status
        marital_val = ec_obj.get("maritalStatus") or ""
        marital_text = flatten_rich_text(marital_val).lower()
        if marital_text:
            raw_parts.append("Marital: " + marital_text)

        # Residence
        res_val = ec_obj.get("residence") or ec_obj.get("area") or ""
        res_text = flatten_rich_text(res_val)
        if res_text:
            raw_parts.append("Residence: " + res_text)
            result["eligible_residence"] = parse_residence_from_text(res_text)

        # Disability
        dis_val = ec_obj.get("disability") or ec_obj.get("pwd") or ""
        dis_text = flatten_rich_text(dis_val).lower()
        if dis_text:
            raw_parts.append("Disability: " + dis_text)
            if dis_text not in ["no", "not applicable", "none"]:
                m = re.search(r'(\d+)\s*%', dis_text)
                if m:
                    result["disability_min_percent"] = int(m.group(1))

        # Combine all text for flag detection
        full_text = " ".join(raw_parts).lower()

        # Also add any other string values from the dict
        for k, v in ec_obj.items():
            if k not in ("ageGroup", "incomeGroup", "caste", "gender", "targetBeneficiary",
                        "maritalStatus", "residence", "disability", "beneficiary", "schemeFor"):
                extra = flatten_rich_text(v)
                if extra and len(extra) > 3:
                    raw_parts.append(f"{k}: {extra}")

        full_text = " ".join(raw_parts).lower()
        result["raw_text"] = " ".join(raw_parts)[:3000]

    # ── Case 2: list of rich-text nodes ─────────────────────────────────────
    elif isinstance(ec_obj, (list, str)):
        full_text = flatten_rich_text(ec_obj).lower()
        result["raw_text"] = full_text[:3000]

        result["min_age"], result["max_age"] = parse_age_from_text(full_text)
        result["max_annual_income"]           = parse_income_from_text(full_text)
        result["eligible_castes"]             = parse_castes_from_obj(full_text)
        result["eligible_genders"]            = parse_genders_from_obj(full_text)
        result["eligible_occupations"]        = parse_occupations_from_obj(full_text)
        result["eligible_ration_cards"]       = parse_ration_cards_from_text(full_text)
        result["eligible_residence"]          = parse_residence_from_text(full_text)
    else:
        return result

    # ── Flags from full_text ─────────────────────────────────────────────────
    t = result["raw_text"].lower()
    result["requires_bank_account"] = bool(
        re.search(r'bank account|savings account|jan dhan|jandhan|bank passbook', t))
    result["requires_aadhaar"] = bool(
        re.search(r'aadhaar|aadhar|uid|unique id', t))
    result["requires_bpl"] = bool(
        re.search(r'\bbpl\b|below poverty|antyodaya|\baay\b|\bphh\b|ration card', t))
    result["requires_disability"] = bool(
        re.search(r'disab|divyang|handicap|\bpwd\b|person with disability', t))
    result["requires_widow"] = bool(
        re.search(r'\bwidow\b|vidhwa|viraangna', t))
    result["requires_student"] = bool(
        re.search(r'\bstudent\b|\bscholar\b|enrolled in|studying in', t))
    result["requires_farmer"] = bool(
        re.search(r'\bfarmer\b|\bkisan\b|\bcultivator\b|landholding', t))

    # Ration cards from combined text
    if not result["eligible_ration_cards"]:
        result["eligible_ration_cards"] = parse_ration_cards_from_text(t)

    # ── Parse confidence ─────────────────────────────────────────────────────
    parsed = sum([
        result["min_age"] is not None,
        result["max_age"] is not None,
        result["max_annual_income"] is not None,
        len(result["eligible_castes"]) > 0,
        len(result["eligible_genders"]) > 0,
        len(result["eligible_occupations"]) > 0,
        any([result["requires_bank_account"], result["requires_aadhaar"],
             result["requires_bpl"], result["requires_farmer"]]),
    ])
    result["parse_confidence"] = round(parsed / 7, 2)

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Re-parse all cached schemes and update DB
# ─────────────────────────────────────────────────────────────────────────────

def reparse_cached_schemes():
    """
    Load all cached scheme detail files, re-run eligibility parser,
    and UPDATE the DB rows with improved structured fields.
    """
    import os
    import psycopg2
    import psycopg2.extras
    from pathlib import Path
    from dotenv import load_dotenv

    load_dotenv()
    DB_CONFIG = {
        "host":     os.getenv("DB_HOST", "localhost"),
        "port":     int(os.getenv("DB_PORT", "5432")),
        "dbname":   os.getenv("DB_NAME", "arthsathi"),
        "user":     os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", "postgres"),
    }

    cache_dir = Path(__file__).parent / "cache" / "schemes"
    files = list(cache_dir.glob("*.json"))
    print(f"Re-parsing {len(files)} cached scheme files...")

    conn = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.DictCursor)
    updated = 0
    skipped = 0

    for fpath in files:
        try:
            with open(fpath, encoding="utf-8") as f:
                raw = json.load(f)

            data = raw.get("data", {})
            slug = data.get("slug") or fpath.stem[:50]
            en   = data.get("en", {})

            # Get eligibilityCriteria — can be dict with eligibilityDescription, or list
            ec_raw = en.get("eligibilityCriteria")
            
            # Also try basicDetails for structured fields
            bd = en.get("basicDetails", {}) or {}
            
            # Build a combined object for parsing
            combined_ec = {}
            if isinstance(ec_raw, dict):
                combined_ec.update(ec_raw)
            elif ec_raw:
                combined_ec["eligibilityDescription"] = ec_raw
            
            # Add basicDetails fields
            if bd:
                for key in ("ageGroup", "incomeGroup", "caste", "gender", "targetBeneficiaries",
                           "maritalStatus", "residence", "disability"):
                    if bd.get(key) and key not in combined_ec:
                        combined_ec[key] = bd[key]
            
            parsed = parse_eligibility_criteria(combined_ec if combined_ec else ec_raw)

            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE schemes SET
                        min_age              = %(min_age)s,
                        max_age              = %(max_age)s,
                        max_annual_income    = %(max_annual_income)s,
                        eligible_genders     = %(genders)s::gender_t[],
                        eligible_castes      = %(castes)s::caste_t[],
                        eligible_occupations = %(occupations)s::occupation_t[],
                        eligible_ration_cards = %(ration_cards)s::ration_card_t[],
                        eligible_residence   = %(residence)s::residence_t[],
                        requires_bank_account = %(req_bank)s,
                        requires_aadhaar     = %(req_aadhaar)s,
                        requires_bpl         = %(req_bpl)s,
                        requires_disability  = %(req_dis)s,
                        requires_widow       = %(req_widow)s,
                        requires_student     = %(req_student)s,
                        requires_farmer      = %(req_farmer)s,
                        parse_confidence     = %(confidence)s
                    WHERE source_id = %(slug)s
                """, {
                    "slug":          slug,
                    "min_age":       parsed["min_age"],
                    "max_age":       parsed["max_age"],
                    "max_annual_income": parsed["max_annual_income"],
                    "genders":       parsed["eligible_genders"] or None,
                    "castes":        parsed["eligible_castes"] or None,
                    "occupations":   parsed["eligible_occupations"] or None,
                    "ration_cards":  parsed["eligible_ration_cards"] or None,
                    "residence":     parsed["eligible_residence"] or None,
                    "req_bank":      parsed["requires_bank_account"],
                    "req_aadhaar":   parsed["requires_aadhaar"],
                    "req_bpl":       parsed["requires_bpl"],
                    "req_dis":       parsed["requires_disability"],
                    "req_widow":     parsed["requires_widow"],
                    "req_student":   parsed["requires_student"],
                    "req_farmer":    parsed["requires_farmer"],
                    "confidence":    parsed["parse_confidence"],
                })
            conn.commit()
            updated += 1

        except Exception as e:
            print(f"  Error for {fpath.name}: {e}")
            conn.rollback()
            skipped += 1

    conn.close()
    print(f"\nRe-parse complete: {updated} updated, {skipped} skipped")

    return updated, skipped


if __name__ == "__main__":
    import sys
    if "--reparse" in sys.argv:
        reparse_cached_schemes()
    else:
        # Quick test
        test_cases = [
            # Dict format
            {
                "ageGroup": "18-40 years",
                "incomeGroup": "Below 1 Lakh",
                "caste": ["SC", "ST", "OBC"],
                "gender": "Female",
                "targetBeneficiary": ["Farmer", "Student"],
                "disability": "40% and above",
            },
            # String format
            "Applicant should be a widow aged 45-65, below poverty line with BPL ration card, Aadhaar required",
            # List format with rich text
            [{"type": "ul_list", "children": [
                {"type": "list_item", "children": [{"text": "Applicant should be SC/ST"}]},
                {"type": "list_item", "children": [{"text": "Age between 18 and 60 years"}]},
                {"type": "list_item", "children": [{"text": "Annual family income should not exceed Rs.1.5 lakh"}]},
            ]}],
        ]

        for i, tc in enumerate(test_cases):
            print(f"\n=== Test {i+1} ===")
            result = parse_eligibility_criteria(tc)
            for k, v in result.items():
                if k != "raw_text" and v:
                    print(f"  {k}: {v}")
