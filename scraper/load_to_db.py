"""
ArthSathi — CSV-to-DB Loader
=============================

Loads schemes from schemes_processed.csv (from the reference dataset)
AND seeds core insurance policies (PMJJBY, PMSBY, PMFBY, AB-PMJAY)
into PostgreSQL.

Usage:
    python load_to_db.py            # full load
    python load_to_db.py --schemes  # schemes only
    python load_to_db.py --insurance # insurance only

The CSV data comes from myscheme.gov.in (3400+ schemes).
parse_schemes.py must have been run first to generate schemes_processed.csv.
If schemes_processed.csv already exists (it does — it's committed), you can
run this directly without re-running parse_schemes.py.
"""

import sys
import io
import os
import csv
import json
import time
import logging
import datetime
import re

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import psycopg2
import psycopg2.extras

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("loader")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROCESSED_CSV = os.path.join(SCRIPT_DIR, "schemes_processed.csv")
RAW_CSV       = os.path.join(SCRIPT_DIR, "schemes_raw.csv")

DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "127.0.0.1"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME", "arthsathifinal"),
    "user":     os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "universe"),
}

# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.DictCursor)


# ─────────────────────────────────────────────────────────────────────────────
# Category mapper  (myscheme categories → DB enum)
# ─────────────────────────────────────────────────────────────────────────────

CATEGORY_MAP = {
    "agriculture":              "agriculture",
    "rural & environment":      "agriculture",
    "health & wellness":        "health",
    "health":                   "health",
    "housing & shelter":        "housing",
    "housing":                  "housing",
    "education & learning":     "education",
    "education":                "education",
    "skills & employment":      "employment",
    "employment":               "employment",
    "social welfare & empowerment": "social_security",
    "social welfare":           "social_security",
    "women and child":          "women_welfare",
    "women":                    "women_welfare",
    "minority affairs":         "minority_welfare",
    "banking, financial services and insurance": "insurance",
    "insurance":                "insurance",
    "disability":               "disability",
    "business & entrepreneurship": "employment",
    "utility & sanitation":     "other",
    "science, it & communications": "other",
    "sports & culture":         "other",
    "transport & infrastructure": "other",
    "law & justice":            "other",
}

def map_category(raw_cat: str) -> str:
    if not raw_cat:
        return "other"
    # schemeCategory can be "Agriculture,Rural & Environment" — take first part
    first = raw_cat.split(",")[0].strip().lower()
    for key, val in CATEGORY_MAP.items():
        if key in first:
            return val
    return "other"


# ─────────────────────────────────────────────────────────────────────────────
# Safe int / float helpers
# ─────────────────────────────────────────────────────────────────────────────

def safe_int(val):
    try:
        f = float(val)
        return int(f) if not (f != f) else None  # NaN check
    except (TypeError, ValueError):
        return None

def safe_float(val):
    try:
        f = float(val)
        return f if not (f != f) else None
    except (TypeError, ValueError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Scheme loader
# ─────────────────────────────────────────────────────────────────────────────

SCHEME_UPSERT = """
INSERT INTO schemes (
    source_id, source_url, name, description, ministry, category,
    tags, benefit_type, benefit_amount_max,
    application_url, is_active, last_scraped_at
) VALUES (
    %(source_id)s,
    %(application_url)s,
    %(name)s::jsonb,
    %(description)s::jsonb,
    %(ministry)s,
    %(category)s,
    %(tags)s,
    'cash_direct'::benefit_type_t,
    %(benefit_amount_max)s,
    %(application_url)s,
    TRUE,
    %(now)s
)
ON CONFLICT (source_id) DO UPDATE SET
    name             = EXCLUDED.name,
    description      = EXCLUDED.description,
    category         = EXCLUDED.category,
    tags             = EXCLUDED.tags,
    benefit_amount_max = EXCLUDED.benefit_amount_max,
    application_url  = EXCLUDED.application_url,
    is_active        = TRUE,
    last_scraped_at  = EXCLUDED.last_scraped_at;
"""


def load_schemes(conn, csv_path: str) -> dict:
    """Load all schemes from the processed CSV into the DB."""
    log.info(f"Loading schemes from {csv_path}")
    inserted = updated = failed = 0
    now = datetime.datetime.utcnow()

    with open(csv_path, encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    log.info(f"  CSV has {len(rows)} rows")

    with conn.cursor() as cur:
        for i, row in enumerate(rows):
            try:
                slug = (row.get("slug") or "").strip()
                if not slug:
                    failed += 1
                    continue

                source_id = f"MYSCHEME-{slug}"
                name_en   = (row.get("scheme_name") or "").strip()[:500]
                details   = (row.get("details")      or "").strip()
                benefits  = (row.get("benefits")     or "").strip()

                # description = benefits if available, else details
                desc_en = benefits[:1000] if benefits else details[:1000]

                raw_cat  = row.get("schemeCategory") or row.get("schemeCategory") or ""
                category = map_category(raw_cat)

                tags_raw = (row.get("tags") or "").strip()
                tags_list = [t.strip() for t in tags_raw.split(",") if t.strip()][:20]

                benefit_amount = safe_float(row.get("benefit_amount_inr"))
                # Cap at 999 crore to avoid numeric overflow (bad CSV rows)
                if benefit_amount and benefit_amount > 9_999_999_999:
                    benefit_amount = None

                app_url = f"https://www.myscheme.gov.in/schemes/{slug}"

                # Check if exists
                cur.execute("SELECT 1 FROM schemes WHERE source_id = %s", (source_id,))
                exists = cur.fetchone() is not None

                cur.execute(SCHEME_UPSERT, {
                    "source_id":        source_id,
                    "name":             json.dumps({"en": name_en, "hi": name_en}, ensure_ascii=False),
                    "description":      json.dumps({"en": desc_en, "hi": desc_en}, ensure_ascii=False),
                    "ministry":         None,
                    "category":         category,
                    "tags":             tags_list,
                    "benefit_amount_max": benefit_amount,
                    "application_url":  app_url,
                    "now":              now,
                })

                if exists:
                    updated += 1
                else:
                    inserted += 1

                if (i + 1) % 200 == 0:
                    conn.commit()
                    log.info(f"  Progress: {i+1}/{len(rows)} — +{inserted} new, {updated} updated, {failed} failed")

            except Exception as e:
                failed += 1
                log.warning(f"  Row {i} ({row.get('slug','')}): {e}")
                conn.rollback()

    conn.commit()
    log.info(f"  Schemes done: +{inserted} inserted, {updated} updated, {failed} failed")
    return {"inserted": inserted, "updated": updated, "failed": failed}


# ─────────────────────────────────────────────────────────────────────────────
# Insurance seeder  (authoritative static data — these never change much)
# ─────────────────────────────────────────────────────────────────────────────

INSURANCE_UPSERT = """
INSERT INTO insurance_policies (
    source_id, source_url, name, description, category, tags,
    benefit_type, annual_premium, coverage_amount, coverage_type,
    min_age, max_age,
    requires_bank_account, requires_jan_dhan,
    administered_by, application_url,
    is_active, last_scraped_at
) VALUES (
    %(source_id)s,
    %(application_url)s,
    %(name)s::jsonb,
    %(description)s::jsonb,
    %(category)s,
    %(tags)s,
    'insurance'::benefit_type_t,
    %(annual_premium)s,
    %(coverage_amount)s,
    %(coverage_type)s,
    %(min_age)s,
    %(max_age)s,
    %(requires_bank_account)s,
    %(requires_jan_dhan)s,
    %(administered_by)s,
    %(application_url)s,
    TRUE,
    %(now)s
)
ON CONFLICT (source_id) DO UPDATE SET
    name             = EXCLUDED.name,
    description      = EXCLUDED.description,
    annual_premium   = EXCLUDED.annual_premium,
    coverage_amount  = EXCLUDED.coverage_amount,
    tags             = EXCLUDED.tags,
    last_scraped_at  = EXCLUDED.last_scraped_at,
    is_active        = TRUE;
"""

INSURANCE_POLICIES = [
    {
        "source_id":           "GOI-PMJJBY-001",
        "name":                {"en": "Pradhan Mantri Jeevan Jyoti Bima Yojana (PMJJBY)", "hi": "प्रधानमंत्री जीवन ज्योति बीमा योजना"},
        "description":         {"en": "Life insurance cover of ₹2 lakh for death due to any reason. Annual premium ₹436 auto-debited from bank account. Renewable annually.", "hi": "किसी भी कारण से मृत्यु पर ₹2 लाख का जीवन बीमा। वार्षिक प्रीमियम ₹436।"},
        "category":            "insurance",
        "tags":                ["life_insurance", "death_cover", "bank_account", "jan_suraksha"],
        "annual_premium":      436.00,
        "coverage_amount":     200000.00,
        "coverage_type":       "life",
        "min_age":             18,
        "max_age":             50,
        "requires_bank_account": True,
        "requires_jan_dhan":   False,
        "administered_by":     "LIC and other life insurance companies via banks",
        "application_url":     "https://jansuraksha.gov.in/Forms-PMJJBY.aspx",
    },
    {
        "source_id":           "GOI-PMSBY-001",
        "name":                {"en": "Pradhan Mantri Suraksha Bima Yojana (PMSBY)", "hi": "प्रधानमंत्री सुरक्षा बीमा योजना"},
        "description":         {"en": "Accident insurance: ₹2 lakh for accidental death or total permanent disability, ₹1 lakh for partial permanent disability. Annual premium only ₹20.", "hi": "दुर्घटना बीमा: आकस्मिक मृत्यु पर ₹2 लाख। वार्षिक प्रीमियम केवल ₹20।"},
        "category":            "insurance",
        "tags":                ["accident_insurance", "disability", "bank_account", "low_premium", "jan_suraksha"],
        "annual_premium":      20.00,
        "coverage_amount":     200000.00,
        "coverage_type":       "accident",
        "min_age":             18,
        "max_age":             70,
        "requires_bank_account": True,
        "requires_jan_dhan":   False,
        "administered_by":     "Non-life insurance companies via banks",
        "application_url":     "https://jansuraksha.gov.in/Forms-PMSBY.aspx",
    },
    {
        "source_id":           "GOI-PMFBY-001",
        "name":                {"en": "Pradhan Mantri Fasal Bima Yojana (PMFBY)", "hi": "प्रधानमंत्री फसल बीमा योजना"},
        "description":         {"en": "Crop insurance for farmers against losses due to natural calamities, pests, and diseases. Farmer pays only 1.5% premium for Kharif and 2% for Rabi crops.", "hi": "किसानों के लिए फसल बीमा। खरीफ के लिए 1.5% और रबी के लिए 2% प्रीमियम।"},
        "category":            "insurance",
        "tags":                ["crop_insurance", "farmer", "natural_disaster", "kharif", "rabi", "agriculture"],
        "annual_premium":      None,
        "coverage_amount":     None,
        "coverage_type":       "crop",
        "min_age":             18,
        "max_age":             None,
        "requires_bank_account": True,
        "requires_jan_dhan":   False,
        "administered_by":     "Agriculture Insurance Company of India",
        "application_url":     "https://pmfby.gov.in",
    },
    {
        "source_id":           "GOI-ABPMJAY-001",
        "name":                {"en": "Ayushman Bharat PM-JAY (AB-PMJAY)", "hi": "आयुष्मान भारत प्रधानमंत्री जन आरोग्य योजना"},
        "description":         {"en": "Health cover of ₹5 lakh per family per year for secondary and tertiary hospitalisation at empanelled hospitals. Cashless treatment. Free for BPL families.", "hi": "परिवार को प्रति वर्ष ₹5 लाख का स्वास्थ्य बीमा। नकद रहित उपचार।"},
        "category":            "health",
        "tags":                ["health_insurance", "hospitalisation", "free", "bpl", "cashless", "ayushman"],
        "annual_premium":      0.00,
        "coverage_amount":     500000.00,
        "coverage_type":       "health",
        "min_age":             None,
        "max_age":             None,
        "requires_bank_account": False,
        "requires_jan_dhan":   False,
        "administered_by":     "National Health Authority",
        "application_url":     "https://beneficiary.nha.gov.in",
    },
    {
        "source_id":           "GOI-AABY-001",
        "name":                {"en": "Aam Aadmi Bima Yojana (AABY)", "hi": "आम आदमी बीमा योजना"},
        "description":         {"en": "Social security scheme for rural landless households. Death benefit ₹30,000, accidental death ₹75,000, partial disability ₹37,500. Premium paid by state & central govt.", "hi": "ग्रामीण भूमिहीन परिवारों के लिए सामाजिक सुरक्षा। मृत्यु पर ₹30,000।"},
        "category":            "insurance",
        "tags":                ["life_insurance", "accident_insurance", "rural", "bpl", "landless", "free"],
        "annual_premium":      0.00,
        "coverage_amount":     75000.00,
        "coverage_type":       "life",
        "min_age":             18,
        "max_age":             59,
        "requires_bank_account": True,
        "requires_jan_dhan":   False,
        "administered_by":     "LIC of India",
        "application_url":     "https://licindia.in/Products/Insurance-Plan/Aam-Aadmi-Bima-Yojana",
    },
    {
        "source_id":           "GOI-NREGSLI-001",
        "name":                {"en": "MGNREGS Life Insurance Scheme", "hi": "मनरेगा जीवन बीमा योजना"},
        "description":         {"en": "Life insurance cover for active MGNREGS workers. Provides financial protection to the families of workers who die during employment.", "hi": "मनरेगा श्रमिकों के लिए जीवन बीमा सुरक्षा।"},
        "category":            "insurance",
        "tags":                ["life_insurance", "mgnregs", "rural", "employment", "workers"],
        "annual_premium":      0.00,
        "coverage_amount":     30000.00,
        "coverage_type":       "life",
        "min_age":             18,
        "max_age":             59,
        "requires_bank_account": True,
        "requires_jan_dhan":   False,
        "administered_by":     "Ministry of Rural Development",
        "application_url":     "https://nrega.nic.in",
    },
]


def load_insurance(conn) -> dict:
    """Seed all insurance policies into the DB."""
    log.info("Loading insurance policies...")
    inserted = updated = failed = 0
    now = datetime.datetime.utcnow()

    with conn.cursor() as cur:
        for policy in INSURANCE_POLICIES:
            try:
                cur.execute("SELECT 1 FROM insurance_policies WHERE source_id = %s", (policy["source_id"],))
                exists = cur.fetchone() is not None

                cur.execute(INSURANCE_UPSERT, {
                    **policy,
                    "name":        json.dumps(policy["name"],        ensure_ascii=False),
                    "description": json.dumps(policy["description"], ensure_ascii=False),
                    "now":         now,
                })
                conn.commit()

                if exists:
                    updated += 1
                    log.info(f"  ✓ Updated: {policy['source_id']}")
                else:
                    inserted += 1
                    log.info(f"  ✓ Inserted: {policy['source_id']}")

            except Exception as e:
                failed += 1
                log.error(f"  ✗ {policy['source_id']}: {e}")
                conn.rollback()

    log.info(f"  Insurance done: +{inserted} inserted, {updated} updated, {failed} failed")
    return {"inserted": inserted, "updated": updated, "failed": failed}


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    do_schemes   = "--schemes"   in args or not args
    do_insurance = "--insurance" in args or not args

    # If processed CSV doesn't exist, run parse_schemes first
    csv_to_use = PROCESSED_CSV
    if not os.path.exists(PROCESSED_CSV):
        if os.path.exists(RAW_CSV):
            log.info("schemes_processed.csv not found — running parse_schemes.py first...")
            import subprocess
            subprocess.run([sys.executable, os.path.join(SCRIPT_DIR, "parse_schemes.py")], check=True)
        else:
            log.error("Neither schemes_processed.csv nor schemes_raw.csv found. Cannot continue.")
            sys.exit(1)

    start = time.time()
    conn = get_conn()

    totals = {"inserted": 0, "updated": 0, "failed": 0}

    if do_schemes:
        r = load_schemes(conn, csv_to_use)
        for k in totals:
            totals[k] += r[k]

    if do_insurance:
        r = load_insurance(conn)
        for k in totals:
            totals[k] += r[k]

    conn.close()
    duration = round(time.time() - start, 1)
    log.info(
        f"=== Done in {duration}s | "
        f"inserted={totals['inserted']}, updated={totals['updated']}, failed={totals['failed']} ==="
    )


if __name__ == "__main__":
    main()
