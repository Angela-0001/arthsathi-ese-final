"""
ArthSathi — Real myscheme.gov.in Scraper
==========================================

Uses the site's actual internal JSON API discovered via Playwright browser
interception. See docs/MYSCHEME_API.md for endpoint documentation.

ARCHITECTURE
------------
1. Paginated fetch of scheme list (5,098 schemes, 510 pages of 10)
2. Per-scheme detail fetch (with disk cache — never re-fetch unchanged data)
3. Structured field extraction from rich-text and metadata fields
4. Upsert into PostgreSQL `schemes` table keyed on source_id (slug)
5. content_hash detects unchanged rows → no unnecessary writes

RATE LIMITING
-----------
1 request/second. Exponential backoff on errors. Checkpoint resume after failure.

USAGE
-----
  python myscheme_scraper.py --mode full        # fetch all 5098 schemes
  python myscheme_scraper.py --mode incremental # fetch first 20 pages only
  python myscheme_scraper.py --mode resume      # continue from last checkpoint
"""

import sys, io
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import os
import re
import json
import time
import hashlib
import logging
import argparse
import datetime
from pathlib import Path
from typing import Optional, Any
import traceback

import httpx
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME", "arthsathi"),
    "user":     os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}

BASE_URL          = "https://www.myscheme.gov.in/api/apisetu"
PAGE_SIZE         = 50       # 50 items per request (max observed working size)
REQUEST_DELAY     = 1.0      # seconds between requests (polite)
MAX_RETRIES       = 3
BACKOFF_BASE      = 2        # exponential backoff: 2^attempt seconds
CACHE_DIR         = Path(__file__).parent / "cache" / "schemes"
CHECKPOINT_FILE   = Path(__file__).parent / "cache" / "checkpoint.json"

HEADERS = {
    "User-Agent": "ArthSathiBot/2.0 (public data aggregator for rural welfare; "
                  "contact: arthsathi@example.in)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.myscheme.gov.in/",
    "Origin": "https://www.myscheme.gov.in",
}

CACHE_DIR.mkdir(parents=True, exist_ok=True)
(Path(__file__).parent / "cache").mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("myscheme_scraper")

# ─────────────────────────────────────────────────────────────────────────────
# HTTP client with retry + disk cache
# ─────────────────────────────────────────────────────────────────────────────

def cache_key(url: str, params: dict) -> str:
    raw = url + json.dumps(params, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def fetch_json(client: httpx.Client, url: str, params: dict = None,
               use_cache: bool = True) -> Optional[dict]:
    """
    Fetch a URL and return JSON, with disk caching and retry logic.
    Returns None on unrecoverable failure.
    """
    params = params or {}
    ckey   = cache_key(url, params)
    cfile  = CACHE_DIR / f"{ckey}.json"

    # Serve from cache if available
    if use_cache and cfile.exists():
        try:
            return json.loads(cfile.read_text(encoding="utf-8"))
        except Exception:
            cfile.unlink(missing_ok=True)

    for attempt in range(MAX_RETRIES):
        try:
            resp = client.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            # Validate API success
            if isinstance(data, dict) and data.get("status") == "Success":
                cfile.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                return data
            elif isinstance(data, dict) and data.get("statusCode") == 200:
                cfile.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                return data
            else:
                log.warning(f"Non-success response from {url}: {str(data)[:200]}")
                return None

        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                wait = (BACKOFF_BASE ** (attempt + 2))
                log.warning(f"Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif e.response.status_code >= 500:
                wait = (BACKOFF_BASE ** attempt)
                log.warning(f"Server error {e.response.status_code}. Retry {attempt+1} in {wait}s")
                time.sleep(wait)
            else:
                log.error(f"HTTP {e.response.status_code} for {url}")
                return None
        except Exception as e:
            wait = BACKOFF_BASE ** attempt
            log.warning(f"Request error ({e}). Retry {attempt+1} in {wait}s")
            time.sleep(wait)

    log.error(f"All {MAX_RETRIES} retries failed for {url}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Rich text extractor (converts myscheme's editor.js format to plain text)
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_rich(obj: Any) -> str:
    """
    Recursively extract plain text from myscheme's rich text (editor.js nodes).
    Handles: paragraph, list_item, ol_list, ul_list, text nodes.
    """
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj.strip()
    if isinstance(obj, list):
        return "\n".join(filter(None, [extract_text_from_rich(item) for item in obj]))
    if isinstance(obj, dict):
        node_type = obj.get("type", "")
        text_val  = obj.get("text", "")
        children  = obj.get("children", [])
        content   = obj.get("content", [])

        if text_val:
            return text_val.strip()
        if children:
            return extract_text_from_rich(children)
        if content:
            return extract_text_from_rich(content)
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# Eligibility field parsers
# ─────────────────────────────────────────────────────────────────────────────

def parse_age(text: str, age_group_field: str = "") -> tuple:
    """
    Return (min_age, max_age) from text or structured age_group field.
    Handles: "18-60 years", "18 to 60 years", "18 years and above", "Below 45"
    """
    # First try the structured ageGroup field
    combined = (age_group_field + " " + text).lower()

    # "X to Y years" or "X-Y years" or "X–Y years"
    m = re.search(r'(\d{1,2})\s*(?:to|[-–])\s*(\d{1,2})\s*year', combined)
    if m:
        return int(m.group(1)), int(m.group(2))

    # "X years and above" / "above X"
    m_above = re.search(r'(?:above|over|minimum|at least|>=?)\s*(\d{1,2})\s*(?:year)?', combined)
    # "below X" / "up to X"
    m_below = re.search(r'(?:below|under|up to|upto|maximum|<=?)\s*(\d{1,2})\s*(?:year)?', combined)

    min_a = int(m_above.group(1)) if m_above else None
    max_a = int(m_below.group(1)) if m_below else None

    if not min_a and not max_a:
        # Try structured like "18-60" without "year"
        m2 = re.search(r'\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b', combined)
        if m2:
            a, b = int(m2.group(1)), int(m2.group(2))
            if 1 <= a < b <= 100:
                return a, b

    return min_a, max_a


def parse_income(text: str, income_group: str = "") -> tuple:
    """
    Return (max_annual_income,) from income text.
    Handles: "Rs.2 lakh", "₹1.5 lakhs", "below 1 lakh per annum",
             "Below 1 Lakh" (from incomeGroup field)
    """
    combined = (income_group + " " + text).lower()

    # X.Y lakh(s)
    m = re.search(r'(\d+(?:\.\d+)?)\s*lakh', combined)
    if m:
        return int(float(m.group(1)) * 100_000)

    # Rs.X,YYY or ₹X,YYY
    m = re.search(r'(?:rs\.?|₹|inr)\s*([\d,]+)', combined)
    if m:
        val = int(m.group(1).replace(",", ""))
        if val > 500:
            return val

    return None


def parse_genders(gender_str: str, eligibility_text: str = "") -> list:
    """Map gender string to enum values."""
    text = (gender_str + " " + eligibility_text).lower()
    genders = []
    if any(w in text for w in ["male", "men", "boy", "father"]):
        genders.append("male")
    if any(w in text for w in ["female", "women", "woman", "girl", "mother", "mahila", "widow"]):
        genders.append("female")
    if any(w in text for w in ["transgender", "third gender", "kinnar"]):
        genders.append("transgender")
    # "male and female" or "all gender" or empty = no restriction
    if len(genders) >= 2 or not genders:
        return []
    return genders


def parse_castes(caste_list: list, eligibility_text: str = "") -> list:
    """Map caste strings to our enum values."""
    text = (json.dumps(caste_list) + " " + eligibility_text).lower()
    castes = []
    if any(w in text for w in ["sc", "scheduled caste", "dalit"]):
        castes.append("sc")
    if any(w in text for w in ["st", "scheduled tribe", "tribal", "adivasi"]):
        castes.append("st")
    if any(w in text for w in ["obc", "other backward"]):
        castes.append("obc")
    if any(w in text for w in ["ews", "economically weaker"]):
        castes.append("ews")
    if any(w in text for w in ["general", "unreserved", "open category"]):
        castes.append("general")
    return castes  # empty = no caste restriction


def parse_occupations(beneficiaries: list) -> list:
    """Map beneficiary strings to occupation enum values."""
    text = " ".join(beneficiaries or []).lower()
    occs = []
    if any(w in text for w in ["farmer", "kisan", "cultivator", "agriculture"]):
        occs.extend(["farmer", "marginal_farmer"])
    if any(w in text for w in ["farm labourer", "agricultural labour", "farm labor"]):
        occs.append("farm_laborer")
    if any(w in text for w in ["artisan", "craftsman", "weaver", "potter", "handicraft"]):
        occs.extend(["artisan", "weaver", "potter"])
    if any(w in text for w in ["fisherman", "fisher", "fishing"]):
        occs.append("fisherman")
    if any(w in text for w in ["student", "scholar"]):
        occs.append("student")
    if any(w in text for w in ["labour", "labourer", "worker", "daily wage", "unorganised"]):
        occs.extend(["daily_wage", "construction_worker"])
    if any(w in text for w in ["self.employed", "entrepreneur", "small business"]):
        occs.append("self_employed")
    if any(w in text for w in ["street vendor", "hawker"]):
        occs.append("street_vendor")
    if any(w in text for w in ["unemployed"]):
        occs.append("unemployed")
    if any(w in text for w in ["widow", "divorcee"]):
        occs.append("homemaker")
    # Remove duplicates
    return list(dict.fromkeys(occs))


def parse_ration_cards(eligibility_text: str) -> list:
    """Extract ration card types from eligibility text."""
    text = eligibility_text.lower()
    cards = []
    if re.search(r'\baay\b|antyodaya', text):
        cards.append("aay")
    if re.search(r'\bphh\b|priority household|bpl', text):
        cards.append("phh")
    if re.search(r'\bnphh\b|non.priority|apl\b|above poverty', text):
        cards.append("nphh")
    if re.search(r'annapurna', text):
        cards.append("annapurna")
    return cards


def infer_category(scheme_categories: list, tags: list, name: str) -> str:
    """Map myscheme category strings to our simplified category."""
    text = " ".join((scheme_categories or []) + (tags or []) + [name]).lower()
    if any(w in text for w in ["agri", "rural", "farmer", "kisan", "crop", "irrigation", "fishery"]):
        return "agriculture"
    if any(w in text for w in ["health", "medical", "hospital", "ayushman", "arogya", "sanitation"]):
        return "health"
    if any(w in text for w in ["education", "scholarship", "school", "college", "learning", "skill", "training"]):
        return "education"
    if any(w in text for w in ["housing", "house", "shelter", "awas", "habitat"]):
        return "housing"
    if any(w in text for w in ["employ", "job", "labour", "wage", "rozgar", "livelihood", "nrega"]):
        return "employment"
    if any(w in text for w in ["women", "mahila", "female", "girl", "beti", "widow", "stri"]):
        return "women_welfare"
    if any(w in text for w in ["minority", "muslim", "christian", "waqf", "urdu"]):
        return "minority_welfare"
    if any(w in text for w in ["disab", "divyang", "handicap", "pwd"]):
        return "disability"
    if any(w in text for w in ["insurance", "bima", "coverage", "premium"]):
        return "insurance"
    if any(w in text for w in ["pension", "social security", "old age", "senior"]):
        return "social_security"
    return "other"


def infer_benefit_type(scheme_data: dict) -> str:
    """Infer benefit type from scheme metadata."""
    btype = " ".join(scheme_data.get("benefitTypes") or []).lower()
    if any(w in btype for w in ["cash", "direct benefit", "dbt", "money", "financial"]):
        return "cash_direct"
    if any(w in btype for w in ["loan", "credit", "mudra"]):
        return "loan"
    if any(w in btype for w in ["subsidy", "subvention"]):
        return "subsidy"
    if any(w in btype for w in ["scholarship", "stipend", "fellowship"]):
        return "scholarship"
    if any(w in btype for w in ["insurance", "bima"]):
        return "insurance"
    if any(w in btype for w in ["service", "facility", "equipment", "tool"]):
        return "service"
    if any(w in btype for w in ["housing", "house", "flat"]):
        return "housing"
    if any(w in btype for w in ["training", "skill"]):
        return "training"
    if any(w in btype for w in ["pension"]):
        return "pension"
    return "other"


def extract_benefit_amount(text: str) -> tuple:
    """
    Return (min_amount, max_amount) from benefit description text.
    Handles lakh/rupee formats.
    """
    # Find all INR amounts in text
    amounts = []
    # lakh format
    for m in re.finditer(r'(?:rs\.?|₹)?\s*(\d+(?:\.\d+)?)\s*lakh', text.lower()):
        amounts.append(float(m.group(1)) * 100_000)
    # Rs.X,YYY format
    for m in re.finditer(r'(?:rs\.?|₹)\s*([\d,]+)', text.lower()):
        val = float(m.group(1).replace(",", ""))
        if 100 < val < 1_000_000_000:  # sanity bounds
            amounts.append(val)

    if not amounts:
        return None, None
    return min(amounts), max(amounts)


# ─────────────────────────────────────────────────────────────────────────────
# Parse a single scheme from its detail API response
# ─────────────────────────────────────────────────────────────────────────────

def parse_scheme_detail(detail: dict, list_fields: dict) -> dict:
    """
    Convert raw API responses into a structured dict ready for DB upsert.
    
    detail    — response from /api/apisetu/schemes?slug=...
    list_fields — fields from the search list hit (slug, schemeName, etc.)
    """
    data      = detail.get("data", {})
    scheme_id = data.get("_id", "")

    # Language content blocks
    en_content = data.get("en", {})
    hi_content = data.get("hi", {})

    # Extract plain text from rich-text fields
    eligibility_raw   = extract_text_from_rich(en_content.get("eligibilityCriteria", []))
    benefit_raw       = extract_text_from_rich(en_content.get("benefitDescription", []))
    app_process_raw   = extract_text_from_rich(en_content.get("applicationProcess", []))
    exclusion_raw     = extract_text_from_rich(en_content.get("exclusionCriteria", []))

    # Hi content
    eligibility_hi = extract_text_from_rich(hi_content.get("eligibilityCriteria", []))
    benefit_hi     = extract_text_from_rich(hi_content.get("benefitDescription", []))

    # Pull structured fields from both list and detail responses
    slug          = list_fields.get("slug") or data.get("slug", "")
    name_en       = list_fields.get("schemeName") or data.get("schemeName", "")
    level         = (list_fields.get("level") or data.get("level", "Central")).lower()
    state_name    = list_fields.get("beneficiaryState") or data.get("state", [])
    if isinstance(state_name, str):
        state_name = [state_name] if state_name else []
    ministry      = (list_fields.get("nodalMinistryName") or data.get("nodalMinistryName", ""))
    dept          = data.get("nodalDepartmentName", "")
    categories    = list_fields.get("schemeCategory") or data.get("schemeCategory") or []
    if isinstance(categories, str):
        categories = [categories]
    tags          = list_fields.get("tags") or data.get("tags") or []
    beneficiaries = data.get("targetBeneficiaries") or []
    benefit_types_raw = data.get("benefitTypes") or []
    age_group     = data.get("ageGroup", "") or ""
    gender_raw    = data.get("gender", "") or ""
    caste_raw     = data.get("caste") or []
    income_group  = data.get("incomeGroup", "") or ""
    marital_raw   = data.get("maritalStatus", "") or ""
    disability_raw = data.get("disability", "") or ""
    residence_raw = data.get("residence", "") or ""
    scheme_close_date = list_fields.get("schemeCloseDate") or data.get("schemeCloseDate")
    brief_desc    = list_fields.get("briefDescription") or ""

    # ── Eligibility parsing ────────────────────────────────────────────────
    full_eligibility_text = eligibility_raw + " " + exclusion_raw

    min_age, max_age = parse_age(full_eligibility_text, age_group)
    max_income       = parse_income(full_eligibility_text, income_group)
    genders          = parse_genders(gender_raw, full_eligibility_text)
    castes           = parse_castes(caste_raw, full_eligibility_text)
    occupations      = parse_occupations(beneficiaries)
    ration_cards     = parse_ration_cards(full_eligibility_text)

    # Flags
    requires_bank    = bool(re.search(r'bank account|bank passbook|savings account|jan dhan', full_eligibility_text, re.I))
    requires_aadhaar = bool(re.search(r'aadhaar|aadhar', full_eligibility_text, re.I))
    requires_bpl     = bool(re.search(r'\bbpl\b|below poverty|antyodaya|phh\b', full_eligibility_text, re.I))
    requires_farmer  = bool(re.search(r'\bfarmer\b|\bkisan\b|\bcultivator\b', full_eligibility_text, re.I))
    requires_disability = bool(re.search(r'disab|divyang|handicap|pwd', full_eligibility_text, re.I))
    requires_widow   = bool(re.search(r'\bwidow\b|\bviraangna\b', full_eligibility_text, re.I))
    requires_student = bool(re.search(r'\bstudent\b|\bscholar\b', full_eligibility_text, re.I))

    # Residence
    eligible_residence = []
    res_text = residence_raw.lower() + " " + full_eligibility_text.lower()
    if "rural" in res_text and "urban" in res_text:
        eligible_residence = ["rural", "urban"]
    elif "rural" in res_text:
        eligible_residence = ["rural"]
    elif "urban" in res_text:
        eligible_residence = ["urban"]

    # Benefit amounts
    ben_min, ben_max = extract_benefit_amount(benefit_raw)
    ben_type = infer_benefit_type(data)
    category = infer_category(categories, tags, name_en)

    # Application deadline
    deadline = None
    if scheme_close_date and scheme_close_date not in ["", "null"]:
        try:
            deadline = datetime.datetime.strptime(scheme_close_date[:10], "%Y-%m-%d").date()
        except Exception:
            pass

    # Criteria JSON (store all structured data + anything we couldn't fully parse)
    criteria_json = {
        "age_group_raw": age_group,
        "gender_raw": gender_raw,
        "caste_raw": caste_raw if isinstance(caste_raw, list) else [caste_raw],
        "income_group_raw": income_group,
        "target_beneficiaries": beneficiaries,
        "marital_status_raw": marital_raw,
        "disability_raw": disability_raw,
        "residence_raw": residence_raw,
        "benefit_types_raw": benefit_types_raw,
        "exclusion_raw": exclusion_raw[:500] if exclusion_raw else "",
        "scheme_categories": categories,
    }

    # Parse confidence: 0-1 based on how many fields we successfully parsed
    parsed_count = sum([
        min_age is not None, max_age is not None,
        max_income is not None,
        len(genders) > 0,
        len(castes) > 0,
        len(occupations) > 0,
        ben_min is not None,
    ])
    parse_confidence = round(parsed_count / 7, 2)

    # Content hash for detecting changes
    raw_payload = {"detail": data, "list_fields": list_fields}
    content_hash = hashlib.sha256(
        json.dumps(raw_payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()

    return {
        "source_id":         slug,
        "source_slug":       slug,
        "source_url":        f"https://www.myscheme.gov.in/schemes/{slug}",
        "content_hash":      content_hash,

        # Multi-language names
        "name": {
            "en": name_en,
            "hi": data.get("hi", {}).get("schemeName") or hi_content.get("schemeName") or name_en,
        },
        "description": {
            "en": brief_desc or (benefit_raw[:500] if benefit_raw else ""),
            "hi": "",
        },
        "benefits_text": {
            "en": benefit_raw[:2000] if benefit_raw else "",
            "hi": benefit_hi[:2000] if benefit_hi else "",
        },
        "eligibility_text": {
            "en": eligibility_raw[:3000] if eligibility_raw else "",
            "hi": eligibility_hi[:3000] if eligibility_hi else "",
        },

        # Classification
        "level":            "central" if "central" in level.lower() else "state",
        "applicable_states": state_name if state_name else None,
        "ministry":         ministry[:400] if ministry else None,
        "department":       dept[:400] if dept else None,
        "category":         category,
        "sub_category":     categories[0][:100] if categories else None,
        "tags":             tags[:20] if tags else [],

        # Benefit
        "benefit_type":       ben_type,
        "benefit_amount_min": ben_min,
        "benefit_amount_max": ben_max,
        "benefit_frequency":  None,

        # Application
        "application_process": {"en": app_process_raw[:2000] if app_process_raw else ""},
        "documents_required":  [],
        "application_url":     f"https://www.myscheme.gov.in/schemes/{slug}",
        "application_deadline": deadline,

        # Eligibility
        "min_age":                min_age,
        "max_age":                max_age,
        "eligible_genders":       genders,
        "eligible_castes":        castes,
        "eligible_occupations":   occupations,
        "eligible_states_exact":  state_name if state_name else None,
        "eligible_ration_cards":  ration_cards,
        "eligible_residence":     eligible_residence,
        "min_annual_income":      None,
        "max_annual_income":      max_income,
        "requires_bank_account":  requires_bank,
        "requires_aadhaar":       requires_aadhaar,
        "requires_bpl":           requires_bpl,
        "requires_farmer":        requires_farmer,
        "requires_disability":    requires_disability,
        "requires_widow":         requires_widow,
        "requires_student":       requires_student,
        "criteria_json":          criteria_json,
        "parse_confidence":       parse_confidence,
        "raw_payload":            raw_payload,

        "_mongo_id":             scheme_id,  # internal use for sub-endpoint fetches
    }


# ─────────────────────────────────────────────────────────────────────────────
# Database upsert
# ─────────────────────────────────────────────────────────────────────────────

def upsert_scheme(conn, scheme: dict, now: datetime.datetime) -> str:
    """
    Upsert a scheme row. Returns 'inserted', 'updated', or 'unchanged'.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT content_hash FROM schemes WHERE source_id = %s", (scheme["source_id"],))
        row = cur.fetchone()

        if row:
            if row[0] == scheme["content_hash"]:
                return "unchanged"
            status = "updated"
        else:
            status = "inserted"

        def arr(lst, pg_type):
            """Safely cast Python list to PostgreSQL array literal."""
            if not lst:
                return None
            return lst  # psycopg2 handles list → array for standard types

        cur.execute("""
            INSERT INTO schemes (
                source_id, source_slug, source_url, content_hash,
                name, description, benefits_text, eligibility_text,
                level, applicable_states, ministry, department,
                category, sub_category, tags,
                benefit_type, benefit_amount_min, benefit_amount_max,
                application_process, documents_required, application_url, application_deadline,
                min_age, max_age, eligible_genders, eligible_castes, eligible_occupations,
                eligible_states_exact, eligible_ration_cards, eligible_residence,
                min_annual_income, max_annual_income,
                requires_bank_account, requires_aadhaar, requires_bpl,
                requires_farmer, requires_disability, requires_widow, requires_student,
                criteria_json, parse_confidence, raw_payload,
                first_scraped_at, last_scraped_at, is_active
            ) VALUES (
                %(source_id)s, %(source_slug)s, %(source_url)s, %(content_hash)s,
                %(name)s::jsonb, %(description)s::jsonb, %(benefits_text)s::jsonb, %(eligibility_text)s::jsonb,
                %(level)s::scheme_level_t, %(applicable_states)s, %(ministry)s, %(department)s,
                %(category)s, %(sub_category)s, %(tags)s,
                %(benefit_type)s::benefit_type_t, %(benefit_amount_min)s, %(benefit_amount_max)s,
                %(application_process)s::jsonb, %(documents_required)s::jsonb, %(application_url)s, %(application_deadline)s,
                %(min_age)s, %(max_age)s, %(eligible_genders)s::gender_t[], %(eligible_castes)s::caste_t[],
                %(eligible_occupations)s::occupation_t[], %(eligible_states_exact)s,
                %(eligible_ration_cards)s::ration_card_t[], %(eligible_residence)s::residence_t[],
                %(min_annual_income)s, %(max_annual_income)s,
                %(requires_bank_account)s, %(requires_aadhaar)s, %(requires_bpl)s,
                %(requires_farmer)s, %(requires_disability)s, %(requires_widow)s, %(requires_student)s,
                %(criteria_json)s::jsonb, %(parse_confidence)s, %(raw_payload)s::jsonb,
                %(now)s, %(now)s, TRUE
            )
            ON CONFLICT (source_id) DO UPDATE SET
                content_hash         = EXCLUDED.content_hash,
                name                 = EXCLUDED.name,
                description          = EXCLUDED.description,
                benefits_text        = EXCLUDED.benefits_text,
                eligibility_text     = EXCLUDED.eligibility_text,
                ministry             = EXCLUDED.ministry,
                category             = EXCLUDED.category,
                tags                 = EXCLUDED.tags,
                benefit_type         = EXCLUDED.benefit_type,
                benefit_amount_min   = EXCLUDED.benefit_amount_min,
                benefit_amount_max   = EXCLUDED.benefit_amount_max,
                min_age              = EXCLUDED.min_age,
                max_age              = EXCLUDED.max_age,
                eligible_genders     = EXCLUDED.eligible_genders,
                eligible_castes      = EXCLUDED.eligible_castes,
                eligible_occupations = EXCLUDED.eligible_occupations,
                eligible_ration_cards = EXCLUDED.eligible_ration_cards,
                max_annual_income    = EXCLUDED.max_annual_income,
                requires_bank_account = EXCLUDED.requires_bank_account,
                requires_bpl         = EXCLUDED.requires_bpl,
                criteria_json        = EXCLUDED.criteria_json,
                parse_confidence     = EXCLUDED.parse_confidence,
                raw_payload          = EXCLUDED.raw_payload,
                last_scraped_at      = EXCLUDED.last_scraped_at,
                is_active            = TRUE
        """, {
            **scheme,
            "name":                json.dumps(scheme["name"],              ensure_ascii=False),
            "description":         json.dumps(scheme["description"],       ensure_ascii=False),
            "benefits_text":       json.dumps(scheme["benefits_text"],     ensure_ascii=False),
            "eligibility_text":    json.dumps(scheme["eligibility_text"],  ensure_ascii=False),
            "application_process": json.dumps(scheme["application_process"], ensure_ascii=False),
            "documents_required":  json.dumps(scheme["documents_required"], ensure_ascii=False),
            "criteria_json":       json.dumps(scheme["criteria_json"],     ensure_ascii=False),
            "raw_payload":         json.dumps({
                "detail": scheme["raw_payload"].get("detail", {}),
                "list_fields": scheme["raw_payload"].get("list_fields", {}),
            }, ensure_ascii=False),
            "eligible_genders":    scheme["eligible_genders"] or None,
            "eligible_castes":     scheme["eligible_castes"] or None,
            "eligible_occupations": scheme["eligible_occupations"] or None,
            "eligible_ration_cards": scheme["eligible_ration_cards"] or None,
            "eligible_residence":  scheme["eligible_residence"] or None,
            "now":                 now,
        })
    conn.commit()
    return status


# ─────────────────────────────────────────────────────────────────────────────
# Checkpoint management
# ─────────────────────────────────────────────────────────────────────────────

def load_checkpoint() -> dict:
    if CHECKPOINT_FILE.exists():
        try:
            return json.loads(CHECKPOINT_FILE.read_text())
        except Exception:
            pass
    return {"last_from": 0, "total_inserted": 0, "total_updated": 0, "total_unchanged": 0}


def save_checkpoint(cp: dict):
    CHECKPOINT_FILE.write_text(json.dumps(cp, indent=2))


# ─────────────────────────────────────────────────────────────────────────────
# Main scraper loop
# ─────────────────────────────────────────────────────────────────────────────

def run_scraper(mode: str = "full"):
    """
    mode:
      'full'        — fetch all pages from the beginning
      'incremental' — fetch first 20 pages only (200 schemes)
      'resume'      — continue from last checkpoint
    """
    start_time = time.time()
    log.info(f"=== ArthSathi myscheme.gov.in Scraper starting ({mode} mode) ===")

    cp     = load_checkpoint() if mode == "resume" else {"last_from": 0, "total_inserted": 0, "total_updated": 0, "total_unchanged": 0}
    conn   = psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.DictCursor)
    now    = datetime.datetime.utcnow()

    # Create scraping_log entry
    log_id = None
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO scraping_log (source, run_type, started_at) VALUES (%s, %s, NOW()) RETURNING id",
            ("myscheme.gov.in", mode)
        )
        log_id = cur.fetchone()[0]
    conn.commit()

    inserted = cp.get("total_inserted", 0)
    updated  = cp.get("total_updated", 0)
    unchanged = cp.get("total_unchanged", 0)
    failed   = 0
    pages_fetched = 0
    error_samples = []

    start_from = cp.get("last_from", 0)
    max_pages  = 20 if mode == "incremental" else 600  # 600 × 50 = 30,000 (more than enough)

    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30) as client:
        current_from = start_from

        while current_from < (start_from + max_pages * PAGE_SIZE):
            # Fetch page
            log.info(f"[PAGE] from={current_from}, inserted={inserted}, updated={updated}, unchanged={unchanged}")

            list_resp = fetch_json(client,
                f"{BASE_URL}/search/schemes/facets",
                params={"lang": "en", "from": current_from, "size": PAGE_SIZE}
            )

            if not list_resp:
                log.error(f"Failed to fetch page from={current_from}")
                failed += 1
                time.sleep(5)
                current_from += PAGE_SIZE
                continue

            hits_data  = list_resp.get("data", {}).get("hits", {})
            page_info  = hits_data.get("page", {})
            items      = hits_data.get("items", [])
            total      = page_info.get("total", 0)

            if not items:
                log.info(f"No more items at from={current_from}. Total={total}. Done.")
                break

            pages_fetched += 1

            for item in items:
                fields = item.get("fields", {})
                slug   = fields.get("slug", "")

                if not slug:
                    log.warning(f"Skipping item with no slug: {item.get('id', 'unknown')}")
                    failed += 1
                    continue

                # Fetch detail
                time.sleep(REQUEST_DELAY)
                detail_resp = fetch_json(client,
                    f"{BASE_URL}/schemes",
                    params={"slug": slug, "lang": "en"}
                )

                if not detail_resp:
                    log.warning(f"Could not fetch detail for slug={slug}")
                    failed += 1
                    error_samples.append(f"detail_fail:{slug}")
                    continue

                try:
                    scheme = parse_scheme_detail(detail_resp, fields)
                    status = upsert_scheme(conn, scheme, now)

                    if status == "inserted":
                        inserted += 1
                    elif status == "updated":
                        updated += 1
                    else:
                        unchanged += 1

                    if (inserted + updated + unchanged) % 10 == 0:
                        log.info(f"  Progress: +{inserted} new, {updated} updated, {unchanged} unchanged")

                except Exception as e:
                    log.error(f"Parse/upsert error for {slug}: {e}")
                    log.debug(traceback.format_exc())
                    failed += 1
                    error_samples.append(f"{slug}: {str(e)[:100]}")
                    conn.rollback()

            # Save checkpoint after each page
            cp = {"last_from": current_from, "total_inserted": inserted,
                  "total_updated": updated, "total_unchanged": unchanged}
            save_checkpoint(cp)

            current_from += PAGE_SIZE
            if current_from >= total:
                log.info(f"Reached total={total}. All pages fetched.")
                break

            time.sleep(REQUEST_DELAY)

    duration = round(time.time() - start_time, 1)

    # Update scraping_log
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE scraping_log SET
                finished_at    = NOW(),
                duration_secs  = %s,
                pages_fetched  = %s,
                rows_inserted  = %s,
                rows_updated   = %s,
                rows_unchanged = %s,
                rows_failed    = %s,
                success        = %s,
                error_samples  = %s::jsonb
            WHERE id = %s
        """, (duration, pages_fetched, inserted, updated, unchanged, failed,
              failed == 0 or (inserted + updated) > 0,
              json.dumps(error_samples[:20]), log_id))
    conn.commit()
    conn.close()

    log.info(f"""
=== Scraper complete in {duration}s ===
  Pages fetched : {pages_fetched}
  Inserted      : {inserted}
  Updated       : {updated}
  Unchanged     : {unchanged}
  Failed        : {failed}
    """)

    return {
        "inserted": inserted, "updated": updated,
        "unchanged": unchanged, "failed": failed,
        "pages_fetched": pages_fetched, "duration_secs": duration,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ArthSathi myscheme.gov.in Scraper")
    parser.add_argument("--mode", default="incremental",
                        choices=["full", "incremental", "resume"],
                        help="full=all 5098, incremental=first 1000, resume=from checkpoint")
    args = parser.parse_args()
    run_scraper(args.mode)
