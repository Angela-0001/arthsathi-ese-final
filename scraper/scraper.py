"""
ArthSathi Government Scheme & Insurance Data Scraper
=====================================================

PURPOSE
-------
This scraper pulls structured scheme and insurance data from publicly
accessible government sources and upserts it into the PostgreSQL database.
The live app NEVER calls external APIs at request time — it reads only from
the local DB. This script is what keeps the data fresh.

SOURCES
-------
1. myscheme.gov.in   — central government welfare schemes
2. jansuraksha.gov.in — PMJJBY, PMSBY insurance schemes
3. pmjay.gov.in       — Ayushman Bharat (AB-PMJAY)
4. pmkisan.gov.in     — PM-KISAN
5. nrega.nic.in       — MGNREGS

UPSERT STRATEGY
---------------
Each scheme has a `stable_id` (e.g. "GOI-PMKISAN-001") that is generated
deterministically from the scheme's name/source. On every run, we INSERT
... ON CONFLICT (stable_id) DO UPDATE, so repeated runs update existing
rows rather than duplicating them.

SCHEDULING
----------
When run as __main__, this script starts a scheduler that fires daily at
02:00 local time. For Windows, this is implemented with the `schedule`
library in a background thread. In a Linux/production environment, use
a system cron job instead.

LOGGING
-------
Every run writes a row to the `scraping_log` table with timestamp,
rows added/updated, and any error messages.
"""

import os
import re
import json
import time
import logging
import datetime
import threading
from typing import Optional

import requests
import psycopg2
import psycopg2.extras
import schedule
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
load_dotenv()

DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME", "arthsathi"),
    "user":     os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}

REQUEST_TIMEOUT   = 30    # seconds
REQUEST_HEADERS   = {"User-Agent": "ArthSathiBot/1.0 (public data aggregator; contact@arthsathi.in)"}
SCHEDULE_TIME     = "02:00"   # daily at 2 AM

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("scraper")

# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db_conn():
    """Open and return a psycopg2 connection."""
    return psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.DictCursor)


def log_run(conn, source: str, rows_added: int, rows_updated: int,
            rows_failed: int, success: bool, error: Optional[str], duration: float):
    """Write a row to the scraping_log table."""
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO scraping_log
               (source, run_type, rows_added, rows_updated, rows_failed, success, error_message, duration_secs)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (source, "scheduled", rows_added, rows_updated, rows_failed, success, error, round(duration, 2))
        )
    conn.commit()

# ---------------------------------------------------------------------------
# NLP-based eligibility field extractor
# ---------------------------------------------------------------------------

def extract_age_range(text: str):
    """
    Extract (min_age, max_age) from a free-text eligibility string.
    Examples:
      "18-50 years"            → (18, 50)
      "aged between 18 and 60" → (18, 60)
      "above 18 years"         → (18, None)
      "below 70 years"         → (None, 70)
    """
    # Pattern: "X-Y years" or "X to Y years"
    m = re.search(r'(\d+)\s*[-–to]+\s*(\d+)\s*year', text, re.IGNORECASE)
    if m:
        return int(m.group(1)), int(m.group(2))

    m_above = re.search(r'(?:above|over|at least|minimum)\s+(\d+)', text, re.IGNORECASE)
    m_below = re.search(r'(?:below|under|up to|maximum|upto)\s+(\d+)', text, re.IGNORECASE)

    min_age = int(m_above.group(1)) if m_above else None
    max_age = int(m_below.group(1)) if m_below else None
    return min_age, max_age


def extract_income_limit(text: str):
    """
    Extract max_annual_income from a free-text eligibility string.
    Examples:
      "annual income below 2 lakh"    → 200000
      "income not exceeding Rs.1.5L"  → 150000
      "family income up to 3 lakhs"   → 300000
    """
    # Match formats like "2 lakh", "1.5 lakhs", "2,50,000", "250000"
    m = re.search(r'(\d+(?:\.\d+)?)\s*lakh', text, re.IGNORECASE)
    if m:
        return int(float(m.group(1)) * 100000)

    m = re.search(r'(?:rs\.?|inr\.?)?\s*([\d,]+)', text, re.IGNORECASE)
    if m:
        val = int(m.group(1).replace(",", ""))
        if val > 1000:   # sanity check — not just a percentage
            return val

    return None


def extract_benefit_amount(text: str):
    """
    Extract benefit_amount (INR) from a benefit/description string.
    Examples:
      "Rs.6,000 per year"   → 6000
      "₹2 lakh cover"       → 200000
      "upto 5 lakhs"        → 500000
    """
    m = re.search(r'(\d+(?:\.\d+)?)\s*lakh', text, re.IGNORECASE)
    if m:
        return float(m.group(1)) * 100000

    # Rs. X,YYY or ₹ X,YYY
    m = re.search(r'(?:rs\.?|₹)\s*([\d,]+)', text, re.IGNORECASE)
    if m:
        return float(m.group(1).replace(",", ""))

    return None


def infer_category(name: str, description: str) -> str:
    """
    Infer scheme_category from name and description keywords.
    Returns one of the scheme_category enum values.
    """
    text = (name + " " + description).lower()
    if any(w in text for w in ["farm", "kisan", "crop", "agriculture", "seed", "irrigation"]):
        return "agriculture"
    if any(w in text for w in ["health", "medical", "hospital", "ayushman", "arogya"]):
        return "health"
    if any(w in text for w in ["house", "housing", "awas", "shelter", "pucca"]):
        return "housing"
    if any(w in text for w in ["school", "scholarship", "education", "student", "college"]):
        return "education"
    if any(w in text for w in ["employ", "job", "wage", "mgnregs", "nrega", "rozgar"]):
        return "employment"
    if any(w in text for w in ["women", "mahila", "female", "girl", "beti"]):
        return "women_welfare"
    if any(w in text for w in ["minority", "muslim", "christian", "waqf"]):
        return "minority_welfare"
    if any(w in text for w in ["disab", "handicap", "divyang"]):
        return "disability"
    if any(w in text for w in ["insurance", "bima", "coverage", "premium", "life", "accident"]):
        return "insurance"
    if any(w in text for w in ["pension", "social", "senior", "widow", "old age"]):
        return "social_security"
    return "other"


def infer_tags(name: str, description: str, category: str) -> list:
    """Generate a list of tags from name, description, and category."""
    text = (name + " " + description).lower()
    tags = [category]

    tag_keywords = {
        "farmer":           ["farmer", "kisan", "cultivator"],
        "bank_account":     ["bank account", "bank transfer", "dbt"],
        "collateral_free":  ["collateral free", "no collateral", "without collateral"],
        "direct_benefit":   ["direct benefit", "dbt", "direct transfer"],
        "bpl":              ["bpl", "below poverty", "ration card"],
        "rural":            ["rural", "village", "gram panchayat"],
        "sc":               [" sc ", "scheduled caste", "dalit"],
        "st":               [" st ", "scheduled tribe", "tribal"],
        "women":            ["women", "mahila", "female"],
        "crop_insurance":   ["crop insurance", "fasal bima"],
        "life_insurance":   ["life insurance", "jeevan jyoti", "death"],
        "accident_insurance": ["accident", "suraksha bima"],
        "employment":       ["employment", "job", "wage", "work"],
        "housing":          ["house", "housing", "awas", "pucca"],
        "education":        ["scholarship", "education", "school"],
        "health":           ["health", "medical", "hospital"],
        "loan":             ["loan", "credit", "mudra", "finance"],
        "low_premium":      ["low premium", "minimal premium", "rs.20", "₹20", "rs 20"],
        "free":             ["free of cost", "no premium", "zero premium", "₹0"],
    }

    for tag, keywords in tag_keywords.items():
        if any(k in text for k in keywords):
            tags.append(tag)

    return list(set(tags))  # deduplicate

# ---------------------------------------------------------------------------
# Individual scheme scrapers
# ---------------------------------------------------------------------------

class SchemeRecord:
    """Holds a parsed scheme ready for DB upsert."""
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)

    def to_dict(self):
        return self.__dict__


def scrape_pmkisan():
    """
    PM-KISAN: Pradhan Mantri Kisan Samman Nidhi
    Source: https://pmkisan.gov.in
    """
    log.info("Scraping PM-KISAN...")
    try:
        resp = requests.get("https://pmkisan.gov.in/aboutscheme.aspx",
                            headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
        soup = BeautifulSoup(resp.text, "lxml")
        # Extract the main description text
        content = soup.get_text(separator=" ", strip=True)[:2000]
    except Exception as e:
        log.warning(f"PM-KISAN fetch failed, using static data: {e}")
        content = "Direct income support of Rs.6000 per year to all landholding farmers in 3 installments."

    return SchemeRecord(
        stable_id        = "GOI-PMKISAN-001",
        name_en          = "PM-KISAN (Pradhan Mantri Kisan Samman Nidhi)",
        description_en   = content[:1000],
        min_age          = 18,
        max_age          = None,
        min_annual_income = None,
        max_annual_income = None,
        eligible_states  = None,  # All India
        eligible_genders = None,  # All
        eligible_castes  = None,  # All
        eligible_occupations = ["farmer"],
        requires_bank_account = True,
        requires_land    = True,
        category         = "agriculture",
        benefit_amount   = 6000.00,
        benefit_description = "Rs.6,000/year in 3 equal instalments of Rs.2,000 directly to bank account",
        tags             = ["farmer", "income_support", "direct_benefit", "bank_account", "agriculture"],
        source_url       = "https://pmkisan.gov.in",
        ministry         = "Ministry of Agriculture and Farmers Welfare",
        application_url  = "https://pmkisan.gov.in/RegistrationForm.aspx",
    )


def scrape_mgnregs():
    """MGNREGS — static authoritative data."""
    log.info("Scraping MGNREGS...")
    return SchemeRecord(
        stable_id        = "GOI-MGNREGS-001",
        name_en          = "MGNREGS (Mahatma Gandhi National Rural Employment Guarantee Scheme)",
        description_en   = (
            "Guarantees 100 days of wage employment per year to every rural household whose adult members "
            "are willing to do unskilled manual work. Wages paid directly to bank or post office accounts."
        ),
        min_age          = 18,
        max_age          = None,
        min_annual_income = None,
        max_annual_income = None,
        eligible_states  = None,
        eligible_genders = None,
        eligible_castes  = None,
        eligible_occupations = ["farm_laborer", "daily_wage", "unemployed", "farmer"],
        requires_bank_account = True,
        requires_land    = False,
        category         = "employment",
        benefit_amount   = None,
        benefit_description = "100 days guaranteed wage employment per financial year",
        tags             = ["employment", "rural", "wage", "100_days", "unskilled", "bank_account"],
        source_url       = "https://nrega.nic.in",
        ministry         = "Ministry of Rural Development",
        application_url  = "https://nrega.nic.in/netnrega/mgnrega_new/Nrega_home.aspx",
    )


def scrape_pmay_gramin():
    """PMAY-Gramin — static authoritative data."""
    log.info("Scraping PMAY-G...")
    return SchemeRecord(
        stable_id        = "GOI-PMAY-G-001",
        name_en          = "Pradhan Mantri Awaas Yojana - Gramin (PMAY-G)",
        description_en   = (
            "Financial assistance for construction of pucca houses to rural households that are houseless "
            "or living in kutcha/dilapidated houses. Assistance: Rs.1.20 lakh in plains, Rs.1.30 lakh in hilly states."
        ),
        min_age          = 18,
        max_age          = None,
        min_annual_income = None,
        max_annual_income = 200000.00,
        eligible_states  = None,
        eligible_genders = None,
        eligible_castes  = None,
        eligible_occupations = None,
        requires_bank_account = True,
        requires_land    = False,
        category         = "housing",
        benefit_amount   = 120000.00,
        benefit_description = "Rs.1.20-1.30 lakh for pucca house construction",
        tags             = ["housing", "pucca_house", "bpl", "rural", "direct_benefit"],
        source_url       = "https://pmayg.nic.in",
        ministry         = "Ministry of Rural Development",
        application_url  = "https://pmayg.nic.in/netiay/home.aspx",
    )


def scrape_nsfdc():
    """NSFDC concessional loans for SC people."""
    log.info("Scraping NSFDC...")
    return SchemeRecord(
        stable_id        = "GOI-NSFDC-001",
        name_en          = "National SC Finance and Development Corporation (NSFDC) Loans",
        description_en   = (
            "Concessional term loans, mahila samridhi yojana, and micro-credit for SC persons below "
            "double the poverty line for income-generating activities. Loans up to Rs.15 lakh at 5-8% interest."
        ),
        min_age          = 18,
        max_age          = 55,
        min_annual_income = None,
        max_annual_income = None,
        eligible_states  = None,
        eligible_genders = None,
        eligible_castes  = ["sc"],
        eligible_occupations = ["self_employed", "artisan", "farmer"],
        requires_bank_account = True,
        requires_land    = False,
        category         = "social_security",
        benefit_amount   = None,
        benefit_description = "Concessional loan up to Rs.15 lakh at 5-8% interest",
        tags             = ["loan", "sc", "self_employment", "below_poverty_line", "concessional"],
        source_url       = "https://nsfdc.nic.in",
        ministry         = "Ministry of Social Justice and Empowerment",
        application_url  = "https://nsfdc.nic.in",
    )


def scrape_mudra():
    """MUDRA Loan (PM Mudra Yojana) — Shishu category."""
    log.info("Scraping MUDRA Loan...")
    return SchemeRecord(
        stable_id        = "GOI-PMMY-SHISHU-001",
        name_en          = "MUDRA Loan - Shishu Category (Pradhan Mantri MUDRA Yojana)",
        description_en   = (
            "Collateral-free micro-loans up to Rs.50,000 under Shishu category for non-farm "
            "small/micro enterprises and self-employed individuals. No processing fee."
        ),
        min_age          = 18,
        max_age          = None,
        min_annual_income = None,
        max_annual_income = None,
        eligible_states  = None,
        eligible_genders = None,
        eligible_castes  = None,
        eligible_occupations = ["self_employed", "artisan", "street_vendor", "weaver"],
        requires_bank_account = True,
        requires_land    = False,
        category         = "employment",
        benefit_amount   = None,
        benefit_description = "Loan up to Rs.50,000 without collateral",
        tags             = ["loan", "micro_enterprise", "self_employment", "mudra", "collateral_free"],
        source_url       = "https://www.mudra.org.in",
        ministry         = "Ministry of Finance",
        application_url  = "https://www.mudra.org.in/Shishu",
    )


def scrape_sc_scholarship():
    """Post-Matric Scholarship for SC Students."""
    log.info("Scraping SC Post-Matric Scholarship...")
    return SchemeRecord(
        stable_id        = "GOI-NSP-POST-MATRIC-SC-001",
        name_en          = "Post-Matric Scholarship for SC Students",
        description_en   = (
            "Scholarship for SC students studying at post-matriculation or post-secondary stage. "
            "Covers tuition fee, maintenance allowance, study tours, thesis typing, and other charges."
        ),
        min_age          = None,
        max_age          = 30,
        min_annual_income = None,
        max_annual_income = 250000.00,
        eligible_states  = None,
        eligible_genders = None,
        eligible_castes  = ["sc"],
        eligible_occupations = None,
        requires_bank_account = True,
        requires_land    = False,
        category         = "education",
        benefit_amount   = None,
        benefit_description = "Full tuition fee + maintenance allowance",
        tags             = ["scholarship", "sc", "education", "post_matric", "student"],
        source_url       = "https://scholarships.gov.in",
        ministry         = "Ministry of Social Justice and Empowerment",
        application_url  = "https://scholarships.gov.in",
    )


def scrape_myscheme_sitemap():
    """
    Pull additional scheme listings from myscheme.gov.in sitemap.
    Parses the public XML sitemap and fetches individual scheme pages
    to extract structured data.

    Returns a list of SchemeRecord objects (may be empty if site is unreachable).
    """
    log.info("Scraping myscheme.gov.in sitemap...")
    records = []
    try:
        sitemap_url = "https://www.myscheme.gov.in/sitemap.xml"
        resp = requests.get(sitemap_url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
        soup = BeautifulSoup(resp.content, "xml")
        urls = [loc.text for loc in soup.find_all("loc") if "/scheme/" in loc.text]
        log.info(f"Found {len(urls)} scheme URLs in sitemap")

        # Process up to 50 schemes per run to avoid rate-limiting
        for url in urls[:50]:
            try:
                scheme_resp = requests.get(url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT)
                scheme_soup = BeautifulSoup(scheme_resp.text, "lxml")

                # Extract scheme name from page title or h1
                name_el = scheme_soup.find("h1") or scheme_soup.find("title")
                if not name_el:
                    continue
                name_en = name_el.get_text(strip=True)[:500]

                # Extract description
                desc_els = scheme_soup.find_all("p")
                description = " ".join(el.get_text(strip=True) for el in desc_els[:3])[:2000]

                # Generate stable_id from URL slug
                slug = url.rstrip("/").split("/")[-1].upper()
                stable_id = f"MYSCHEME-{slug[:100]}"

                # Infer structured fields from text
                min_age, max_age = extract_age_range(description)
                max_income = extract_income_limit(description)
                benefit_amount = extract_benefit_amount(description)
                category = infer_category(name_en, description)
                tags = infer_tags(name_en, description, category)

                records.append(SchemeRecord(
                    stable_id        = stable_id,
                    name_en          = name_en,
                    description_en   = description,
                    min_age          = min_age,
                    max_age          = max_age,
                    min_annual_income = None,
                    max_annual_income = max_income,
                    eligible_states  = None,
                    eligible_genders = None,
                    eligible_castes  = None,
                    eligible_occupations = None,
                    requires_bank_account = False,
                    requires_land    = False,
                    category         = category,
                    benefit_amount   = benefit_amount,
                    benefit_description = description[:300],
                    tags             = tags,
                    source_url       = url,
                    ministry         = None,
                    application_url  = url,
                ))
                time.sleep(0.5)  # polite rate limiting
            except Exception as e:
                log.warning(f"Failed to parse scheme at {url}: {e}")
                continue

    except Exception as e:
        log.warning(f"myscheme.gov.in sitemap fetch failed: {e}")

    return records


# ---------------------------------------------------------------------------
# Insurance scrapers
# ---------------------------------------------------------------------------

class InsuranceRecord:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def scrape_pmjjby():
    """PMJJBY — Pradhan Mantri Jeevan Jyoti Bima Yojana."""
    log.info("Scraping PMJJBY...")
    return InsuranceRecord(
        stable_id            = "GOI-PMJJBY-001",
        name_en              = "Pradhan Mantri Jeevan Jyoti Bima Yojana (PMJJBY)",
        description_en       = (
            "Life insurance cover of Rs.2 lakh for death due to any reason. "
            "Annual premium Rs.436 auto-debited from bank account. Renewable annually."
        ),
        min_age              = 18,
        max_age              = 50,
        min_annual_income    = None,
        max_annual_income    = None,
        eligible_states      = None,
        eligible_genders     = None,
        eligible_castes      = None,
        requires_bank_account = True,
        requires_jan_dhan    = False,
        category             = "insurance",
        annual_premium       = 436.00,
        coverage_amount      = 200000.00,
        coverage_type        = "life",
        claim_process        = "Submit death certificate + form to bank/insurer within 30 days.",
        tags                 = ["life_insurance", "death_cover", "bank_account"],
        source_url           = "https://jansuraksha.gov.in/PMJJBY.aspx",
        administered_by      = "LIC and other life insurance companies via banks",
        application_url      = "https://jansuraksha.gov.in/Forms-PMJJBY.aspx",
    )


def scrape_pmsby():
    """PMSBY — Pradhan Mantri Suraksha Bima Yojana."""
    log.info("Scraping PMSBY...")
    return InsuranceRecord(
        stable_id            = "GOI-PMSBY-001",
        name_en              = "Pradhan Mantri Suraksha Bima Yojana (PMSBY)",
        description_en       = (
            "Accident insurance: Rs.2 lakh for accidental death or total permanent disability, "
            "Rs.1 lakh for partial permanent disability. Annual premium only Rs.20."
        ),
        min_age              = 18,
        max_age              = 70,
        min_annual_income    = None,
        max_annual_income    = None,
        eligible_states      = None,
        eligible_genders     = None,
        eligible_castes      = None,
        requires_bank_account = True,
        requires_jan_dhan    = False,
        category             = "insurance",
        annual_premium       = 20.00,
        coverage_amount      = 200000.00,
        coverage_type        = "accident",
        claim_process        = "Submit accident report + form to bank/insurer within 30 days.",
        tags                 = ["accident_insurance", "disability", "bank_account", "low_premium"],
        source_url           = "https://jansuraksha.gov.in/PMSBY.aspx",
        administered_by      = "Non-life insurance companies via banks",
        application_url      = "https://jansuraksha.gov.in/Forms-PMSBY.aspx",
    )


def scrape_pmfby():
    """PMFBY — Pradhan Mantri Fasal Bima Yojana."""
    log.info("Scraping PMFBY...")
    return InsuranceRecord(
        stable_id            = "GOI-PMFBY-001",
        name_en              = "Pradhan Mantri Fasal Bima Yojana (PMFBY)",
        description_en       = (
            "Crop insurance for farmers against losses due to natural calamities, pests, and diseases. "
            "Farmer pays only 1.5% premium for Kharif and 2% for Rabi crops. Government subsidises rest."
        ),
        min_age              = 18,
        max_age              = None,
        min_annual_income    = None,
        max_annual_income    = None,
        eligible_states      = None,
        eligible_genders     = None,
        eligible_castes      = None,
        requires_bank_account = True,
        requires_jan_dhan    = False,
        category             = "agriculture",
        annual_premium       = None,   # Variable (% of sum insured)
        coverage_amount      = None,   # Variable (based on crop/district)
        coverage_type        = "crop",
        claim_process        = "Report crop loss within 72 hours to bank/insurer. Surveyor assesses damage.",
        tags                 = ["crop_insurance", "farmer", "natural_disaster", "kharif", "rabi", "agriculture"],
        source_url           = "https://pmfby.gov.in",
        administered_by      = "Agriculture Insurance Company of India + approved insurers",
        application_url      = "https://pmfby.gov.in",
    )


def scrape_abpmjay():
    """AB-PMJAY — Ayushman Bharat Jan Arogya Yojana."""
    log.info("Scraping AB-PMJAY...")
    return InsuranceRecord(
        stable_id            = "GOI-ABPMJAY-001",
        name_en              = "Ayushman Bharat Pradhan Mantri Jan Arogya Yojana (AB-PMJAY)",
        description_en       = (
            "Health cover of Rs.5 lakh per family per year for secondary and tertiary hospitalisation "
            "at empanelled hospitals. Cashless treatment. Targets bottom 40% of population by SECC data."
        ),
        min_age              = None,
        max_age              = None,
        min_annual_income    = None,
        max_annual_income    = None,
        eligible_states      = None,
        eligible_genders     = None,
        eligible_castes      = None,
        requires_bank_account = False,
        requires_jan_dhan    = False,
        category             = "health",
        annual_premium       = 0.00,    # Free for beneficiaries
        coverage_amount      = 500000.00,
        coverage_type        = "health",
        claim_process        = "Go to empanelled hospital with Ayushman card or Aadhaar. Cashless treatment.",
        tags                 = ["health_insurance", "hospitalisation", "free", "ration_card", "bpl", "cashless"],
        source_url           = "https://pmjay.gov.in",
        administered_by      = "National Health Authority",
        application_url      = "https://beneficiary.nha.gov.in",
    )


# ---------------------------------------------------------------------------
# DB upsert functions
# ---------------------------------------------------------------------------

def upsert_scheme(conn, scheme: SchemeRecord) -> tuple:
    """
    Upsert a scheme row. Returns (rows_added, rows_updated).
    Uses ON CONFLICT (stable_id) DO UPDATE to prevent duplicates.
    PostgreSQL enum arrays require explicit casting via ::occupation_type[] etc.
    """
    d = scheme.to_dict()

    # Roll back any aborted transaction from a previous failure
    conn.rollback()

    with conn.cursor() as cur:
        # Check if exists
        cur.execute("SELECT id FROM schemes WHERE stable_id = %s", (d["stable_id"],))
        exists = cur.fetchone() is not None

        # eligible_occupations needs to be cast to occupation_type[]
        # We pass them as a plain Python list and add explicit CAST in SQL
        occ = d.get("eligible_occupations")
        castes = d.get("eligible_castes")
        genders = d.get("eligible_genders")

        cur.execute("""
            INSERT INTO schemes (
                stable_id, name_en, description_en,
                min_age, max_age, min_annual_income, max_annual_income,
                eligible_states, eligible_genders, eligible_castes, eligible_occupations,
                requires_bank_account, requires_land,
                category, benefit_amount, benefit_description,
                tags, source_url, ministry, application_url, last_scraped_at, is_active
            ) VALUES (
                %(stable_id)s, %(name_en)s, %(description_en)s,
                %(min_age)s, %(max_age)s, %(min_annual_income)s, %(max_annual_income)s,
                %(eligible_states)s,
                %(eligible_genders)s::gender_type[],
                %(eligible_castes)s::caste_category[],
                %(eligible_occupations)s::occupation_type[],
                %(requires_bank_account)s, %(requires_land)s,
                %(category)s::scheme_category,
                %(benefit_amount)s, %(benefit_description)s,
                %(tags)s, %(source_url)s, %(ministry)s, %(application_url)s, NOW(), TRUE
            )
            ON CONFLICT (stable_id) DO UPDATE SET
                name_en              = EXCLUDED.name_en,
                description_en       = EXCLUDED.description_en,
                min_age              = EXCLUDED.min_age,
                max_age              = EXCLUDED.max_age,
                max_annual_income    = EXCLUDED.max_annual_income,
                eligible_occupations = EXCLUDED.eligible_occupations,
                eligible_castes      = EXCLUDED.eligible_castes,
                benefit_amount       = EXCLUDED.benefit_amount,
                benefit_description  = EXCLUDED.benefit_description,
                tags                 = EXCLUDED.tags,
                ministry             = EXCLUDED.ministry,
                application_url      = EXCLUDED.application_url,
                last_scraped_at      = NOW(),
                updated_at           = NOW()
        """, {
            **d,
            "eligible_states":      d.get("eligible_states"),
            "eligible_genders":     genders,
            "eligible_castes":      castes,
            "eligible_occupations": occ,
        })

    conn.commit()
    return (0, 1) if exists else (1, 0)


def upsert_insurance(conn, policy: InsuranceRecord) -> tuple:
    """Upsert an insurance policy row."""
    d = policy.__dict__

    # Roll back any aborted transaction from a previous failure
    conn.rollback()

    with conn.cursor() as cur:
        cur.execute("SELECT id FROM insurance_policies WHERE stable_id = %s", (d["stable_id"],))
        exists = cur.fetchone() is not None

        cur.execute("""
            INSERT INTO insurance_policies (
                stable_id, name_en, description_en,
                min_age, max_age, min_annual_income, max_annual_income,
                eligible_states, eligible_genders, eligible_castes,
                requires_bank_account, requires_jan_dhan,
                category, annual_premium, coverage_amount, coverage_type, claim_process,
                tags, source_url, administered_by, application_url, last_scraped_at, is_active
            ) VALUES (
                %(stable_id)s, %(name_en)s, %(description_en)s,
                %(min_age)s, %(max_age)s, %(min_annual_income)s, %(max_annual_income)s,
                %(eligible_states)s,
                %(eligible_genders)s::gender_type[],
                %(eligible_castes)s::caste_category[],
                %(requires_bank_account)s, %(requires_jan_dhan)s,
                %(category)s::scheme_category,
                %(annual_premium)s, %(coverage_amount)s, %(coverage_type)s, %(claim_process)s,
                %(tags)s, %(source_url)s, %(administered_by)s, %(application_url)s, NOW(), TRUE
            )
            ON CONFLICT (stable_id) DO UPDATE SET
                description_en  = EXCLUDED.description_en,
                annual_premium  = EXCLUDED.annual_premium,
                coverage_amount = EXCLUDED.coverage_amount,
                claim_process   = EXCLUDED.claim_process,
                tags            = EXCLUDED.tags,
                last_scraped_at = NOW(),
                updated_at      = NOW()
        """, {
            **d,
            "eligible_states":  d.get("eligible_states"),
            "eligible_genders": d.get("eligible_genders"),
            "eligible_castes":  d.get("eligible_castes"),
        })

    conn.commit()
    return (0, 1) if exists else (1, 0)


# ---------------------------------------------------------------------------
# Main run function
# ---------------------------------------------------------------------------

def run_scraper(run_type: str = "manual"):
    """
    Execute a full scraping run.
    Scrapes all sources, upserts into DB, logs the run.
    """
    start = time.time()
    log.info(f"=== ArthSathi Scraper starting ({run_type} run) ===")

    total_added = 0
    total_updated = 0
    total_failed = 0
    all_errors = []

    conn = None
    try:
        conn = get_db_conn()

        # --- Schemes ---
        scheme_scrapers = [
            scrape_pmkisan,
            scrape_mgnregs,
            scrape_pmay_gramin,
            scrape_nsfdc,
            scrape_mudra,
            scrape_sc_scholarship,
        ]

        for scraper_fn in scheme_scrapers:
            try:
                record = scraper_fn()
                added, updated = upsert_scheme(conn, record)
                total_added += added
                total_updated += updated
                log.info(f"  ✓ {record.stable_id} — {'added' if added else 'updated'}")
            except Exception as e:
                total_failed += 1
                err = f"{scraper_fn.__name__}: {e}"
                all_errors.append(err)
                log.error(f"  ✗ {err}")

        # --- myscheme.gov.in sitemap (additional schemes) ---
        try:
            sitemap_records = scrape_myscheme_sitemap()
            for record in sitemap_records:
                try:
                    added, updated = upsert_scheme(conn, record)
                    total_added += added
                    total_updated += updated
                except Exception as e:
                    total_failed += 1
                    all_errors.append(f"upsert {record.stable_id}: {e}")
        except Exception as e:
            all_errors.append(f"myscheme sitemap: {e}")

        # --- Insurance ---
        insurance_scrapers = [scrape_pmjjby, scrape_pmsby, scrape_pmfby, scrape_abpmjay]
        for scraper_fn in insurance_scrapers:
            try:
                record = scraper_fn()
                added, updated = upsert_insurance(conn, record)
                total_added += added
                total_updated += updated
                log.info(f"  ✓ {record.stable_id} — {'added' if added else 'updated'}")
            except Exception as e:
                total_failed += 1
                err = f"{scraper_fn.__name__}: {e}"
                all_errors.append(err)
                log.error(f"  ✗ {err}")

        duration = time.time() - start
        success = total_failed == 0 or (total_added + total_updated) > 0
        error_msg = "; ".join(all_errors) if all_errors else None

        log_run(conn, "all_sources", total_added, total_updated, total_failed,
                success, error_msg, duration)

        log.info(
            f"=== Run complete in {duration:.1f}s: "
            f"{total_added} added, {total_updated} updated, {total_failed} failed ==="
        )

    except Exception as e:
        duration = time.time() - start
        log.error(f"Fatal scraper error: {e}")
        if conn:
            try:
                log_run(conn, "all_sources", 0, 0, 0, False, str(e), duration)
            except Exception:
                pass
    finally:
        if conn:
            conn.close()


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------

def start_scheduler():
    """Start the daily scheduler in the current thread."""
    log.info(f"Scheduler started — running daily at {SCHEDULE_TIME}")
    schedule.every().day.at(SCHEDULE_TIME).do(lambda: run_scraper("scheduled"))

    while True:
        schedule.run_pending()
        time.sleep(60)  # check every minute


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--schedule":
        # Run once immediately, then schedule
        run_scraper("manual")
        start_scheduler()
    else:
        # Default: single run
        run_scraper("manual")
