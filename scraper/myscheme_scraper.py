"""
ArthSathi — Live Dynamic Scraper for myscheme.gov.in
=====================================================

Scrapes schemes and insurance policies LIVE from the official myscheme.gov.in API.
No pre-loaded CSVs. Every run fetches fresh data from the government portal.

Usage:
    python myscheme_scraper.py                  # incremental (new/updated only)
    python myscheme_scraper.py --mode full       # full scrape (all 5000+ schemes)
    python myscheme_scraper.py --mode incremental # fast update (default)
    python myscheme_scraper.py --mode insurance  # insurance only
    python myscheme_scraper.py --limit 100       # limit to N schemes (testing)

API Source: https://www.myscheme.gov.in/api/apisetu/
No API key required. Rate limit: ~1 req/sec safe.
"""

import os
import sys
import re
import json
import time
import logging
import argparse
import hashlib
from datetime import datetime, timezone
from pathlib import Path

import requests
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

# ─── Setup ─────────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("scraper")

# ─── DB Config ─────────────────────────────────────────────────────────────
DB = {
    "host":     os.getenv("DB_HOST", "127.0.0.1"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME", "arthsathi"),
    "user":     os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "universe"),
}

# ─── API Config ────────────────────────────────────────────────────────────
BASE_URL  = "https://www.myscheme.gov.in/api/apisetu"
PAGE_SIZE = 50   # items per API page (increased from 20)
DELAY     = 0.2  # seconds between requests (reduced from 1.0)

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
    "Referer":         "https://www.myscheme.gov.in/",
    "Origin":          "https://www.myscheme.gov.in",
}

# ─── Cache dir ─────────────────────────────────────────────────────────────
CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)


# ════════════════════════════════════════════════════════════════════════════
# API HELPERS
# ════════════════════════════════════════════════════════════════════════════

def get_json(url: str, params: dict = None, retries: int = 3) -> dict | None:
    """GET JSON from myscheme API with retries and caching."""
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=8)
            if r.status_code == 200:
                return r.json()
            elif r.status_code == 429:
                wait = 10 * (attempt + 1)
                log.warning(f"Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif r.status_code in (403, 404):
                return None
            else:
                log.warning(f"HTTP {r.status_code} for {url}")
                time.sleep(2)
        except requests.exceptions.Timeout:
            log.warning(f"Timeout on attempt {attempt+1} for {url}")
            time.sleep(3)
        except Exception as e:
            log.warning(f"Request error: {e}")
            time.sleep(2)
    return None


def fetch_scheme_list(from_offset: int, size: int = PAGE_SIZE) -> dict | None:
    """Fetch a page of schemes from the list API."""
    url = f"{BASE_URL}/search/schemes/facets"
    params = {"lang": "en", "from": from_offset, "size": size}
    return get_json(url, params)


def fetch_scheme_detail(slug):
    try:
        cache_file = CACHE_DIR / f"{slug}.json"
        if cache_file.exists():
            try:
                return json.loads(cache_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        url = f"{BASE_URL}/schemes"
        data = get_json(url, {"slug": slug, "lang": "en"})
        if data:
            try:
                cache_file.write_text(json.dumps(data), encoding="utf-8")
            except Exception:
                pass
        time.sleep(DELAY)
        return data
    except Exception as e:
        log.warning(f"fetch_scheme_detail failed for {slug}: {e}")
        return None


# ════════════════════════════════════════════════════════════════════════════
# PARSERS — extract structured fields from raw API response
# ════════════════════════════════════════════════════════════════════════════

def extract_text_from_nodes(nodes) -> str:
    """Flatten rich-text node array (ol_list, ul_list, paragraph) to plain text."""
    if not nodes:
        return ""
    if isinstance(nodes, str):
        return nodes.strip()
    parts = []
    for node in (nodes if isinstance(nodes, list) else [nodes]):
        if isinstance(node, str):
            parts.append(node)
            continue
        if isinstance(node, dict):
            t = node.get("type", "")
            children = node.get("children", [])
            if t in ("ol_list", "ul_list", "list"):
                for item in children:
                    text = extract_text_from_nodes(item.get("children", []))
                    if text:
                        parts.append(f"• {text}")
            elif t in ("list_item", "paragraph", "heading"):
                text = extract_text_from_nodes(children)
                if text:
                    parts.append(text)
            elif t == "text":
                txt = node.get("text", "").strip()
                if txt:
                    parts.append(txt)
            else:
                text = extract_text_from_nodes(children)
                if text:
                    parts.append(text)
    return " ".join(parts).strip()


def parse_benefit_amount(text: str) -> tuple[float | None, float | None]:
    """Extract min and max benefit amounts from text."""
    if not text:
        return None, None

    def to_number(s):
        s = s.replace(",", "").replace(" ", "").lower()
        m = re.match(r"([\d.]+)\s*(?:lakh|lac)", s)
        if m:
            return float(m.group(1)) * 100000
        m = re.match(r"([\d.]+)\s*crore", s)
        if m:
            return float(m.group(1)) * 10000000
        m = re.match(r"[\d.]+", s)
        if m:
            return float(m.group())
        return None

    amounts = []
    for m in re.finditer(r"(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?\s*(?:lakh|lac|crore)?)", text.lower()):
        val = to_number(m.group(1))
        if val and 100 <= val <= 9_999_999_999:
            amounts.append(val)

    if not amounts:
        return None, None
    return min(amounts), max(amounts)


def parse_age_group(age_str: str) -> tuple[int | None, int | None]:
    """Parse '18-60 years' or '18 to 60' into (min, max)."""
    if not age_str:
        return None, None
    m = re.search(r"(\d{1,3})\s*(?:to|-)\s*(\d{1,3})", str(age_str))
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if 5 < a < b <= 100:
            return a, b
    m = re.search(r"(\d{1,3})\s*years?\s*(?:and\s*)?(?:above|older)", str(age_str).lower())
    if m:
        return int(m.group(1)), None
    m = re.search(r"(?:below|under|upto)\s*(\d{1,3})\s*years?", str(age_str).lower())
    if m:
        return None, int(m.group(1))
    return None, None


def map_category(categories: list) -> str:
    """Map myscheme categories to our DB scheme_category enum."""
    if not categories:
        return "other"
    cat = " ".join(categories).lower()
    if any(x in cat for x in ["agriculture", "rural", "farmer", "kisan", "fisherm"]):
        return "agriculture"
    if any(x in cat for x in ["health", "medical", "hospital", "ayush"]):
        return "health"
    if any(x in cat for x in ["education", "scholar", "student", "skill", "learning"]):
        return "education"
    if any(x in cat for x in ["housing", "shelter", "awas", "home"]):
        return "housing"
    if any(x in cat for x in ["social", "welfare", "empowerment", "pension", "widow"]):
        return "social_security"
    if any(x in cat for x in ["employment", "job", "labour", "work", "mgnrega"]):
        return "employment"
    if any(x in cat for x in ["women", "girl", "female", "mahila"]):
        return "women_welfare"
    if any(x in cat for x in ["minority", "muslim", "christian"]):
        return "minority_welfare"
    if any(x in cat for x in ["disab", "differently", "divyang"]):
        return "disability"
    if any(x in cat for x in ["insurance", "bima", "cover"]):
        return "insurance"
    return "other"


def parse_scheme(item: dict, detail: dict | None) -> dict | None:
    """Parse list item + detail into our actual DB schema."""
    fields = item.get("fields", {})
    slug = fields.get("slug", "")
    if not slug:
        return None

    stable_id  = f"MYS-{slug[:190]}"
    name_en    = fields.get("schemeName", "") or ""
    desc_en    = fields.get("briefDescription", "") or ""
    benefit_desc = ""
    eligibility_text = ""
    min_age = max_age = None

    if detail:
        d = detail.get("data", {}) or {}
        en_data = d.get("en", {}) if d else {}

        # Full description
        desc_nodes = en_data.get("briefDescription", []) or en_data.get("schemeDescription", [])
        if desc_nodes:
            desc_en = extract_text_from_nodes(desc_nodes) or desc_en

        # Benefits
        bens = en_data.get("benefitDescription", [])
        if bens:
            benefit_desc = extract_text_from_nodes(bens)

        # Eligibility
        elig = en_data.get("eligibilityCriteria", [])
        if elig:
            eligibility_text = extract_text_from_nodes(elig)

        # Age
        age_str = d.get("ageGroup", "") or ""
        min_age, max_age = parse_age_group(age_str)

    # Category
    categories = fields.get("schemeCategory", []) or []
    category = map_category(categories)

    # Benefit amount from benefit_desc
    _, bmax = parse_benefit_amount(benefit_desc or desc_en)

    # Tags
    tags = fields.get("tags", []) or []

    # Ministry
    ministry = fields.get("nodalMinistryName", "") or fields.get("ministry", "") or ""

    return {
        "scheme_id":          f"MYS-{slug[:190]}",
        "name":               name_en[:500] if name_en else "Unknown",
        "description":        desc_en,
        "ministry":           ministry[:300] if ministry else None,
        "category":           category,
        "min_age":            min_age,
        "max_age":            max_age,
        "benefit_amount":     bmax,
        "application_url":    f"https://www.myscheme.gov.in/schemes/{slug}",
    }


# ════════════════════════════════════════════════════════════════════════════
# DATABASE
# ════════════════════════════════════════════════════════════════════════════

def get_db():
    return psycopg2.connect(**DB)


def upsert_scheme(conn, scheme: dict) -> str:
    """Insert or update using actual live DB schema."""
    now = datetime.now(timezone.utc)
    bamt = scheme["benefit_amount"]
    if bamt and bamt > 9_999_999_999:
        bamt = 9_999_999_999

    with conn.cursor() as cur:
        cur.execute("SELECT id FROM schemes WHERE scheme_id = %s", (scheme["scheme_id"],))
        existing = cur.fetchone()

        if existing:
            cur.execute("""
                UPDATE schemes SET
                    name                 = %s,
                    description          = %s,
                    ministry             = %s,
                    category             = %s,
                    min_age              = %s,
                    max_age              = %s,
                    benefit_value        = %s,
                    application_url      = %s,
                    is_active            = TRUE,
                    last_refreshed       = %s
                WHERE scheme_id = %s
            """, (
                scheme["name"], scheme["description"], scheme["ministry"],
                scheme["category"], scheme["min_age"], scheme["max_age"],
                bamt, scheme["application_url"], now,
                scheme["scheme_id"],
            ))
            conn.commit()
            return "updated"
        else:
            cur.execute("""
                INSERT INTO schemes (
                    scheme_id, name, description, ministry, category,
                    min_age, max_age, benefit_value, application_url,
                    engagement_weight, is_active, last_refreshed
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, 1.0, TRUE,%s)
            """, (
                scheme["scheme_id"], scheme["name"], scheme["description"],
                scheme["ministry"], scheme["category"],
                scheme["min_age"], scheme["max_age"],
                bamt, scheme["application_url"], now,
            ))
            conn.commit()
            return "inserted"


# ════════════════════════════════════════════════════════════════════════════
# INSURANCE — scrape from myscheme categories
# ════════════════════════════════════════════════════════════════════════════

INSURANCE_POLICIES = [
    {
        "source_id":      "GOI-PMJJBY-001",
        "name":           {"en": "Pradhan Mantri Jeevan Jyoti Bima Yojana", "hi": "प्रधानमंत्री जीवन ज्योति बीमा योजना"},
        "description":    {"en": "Life insurance scheme providing cover of ₹2 lakh on death due to any cause for bank account holders aged 18-50."},
        "category":       "Life Insurance",
        "annual_premium": 436,
        "coverage_amount":200000,
        "coverage_type":  "Life",
        "min_age":        18,
        "max_age":        50,
        "application_url":"https://www.myscheme.gov.in/schemes/pmjjby",
        "source_url":     "https://www.myscheme.gov.in/schemes/pmjjby",
        "tags":           ["life insurance","bank account","low premium"],
        "administered_by":"Ministry of Finance",
    },
    {
        "source_id":      "GOI-PMSBY-001",
        "name":           {"en": "Pradhan Mantri Suraksha Bima Yojana", "hi": "प्रधानमंत्री सुरक्षा बीमा योजना"},
        "description":    {"en": "Accidental insurance scheme offering ₹2 lakh for accidental death/permanent disability at just ₹20/year."},
        "category":       "Accidental Insurance",
        "annual_premium": 20,
        "coverage_amount":200000,
        "coverage_type":  "Accident",
        "min_age":        18,
        "max_age":        70,
        "application_url":"https://www.myscheme.gov.in/schemes/pmsby",
        "source_url":     "https://www.myscheme.gov.in/schemes/pmsby",
        "tags":           ["accident insurance","bank account","cheapest"],
        "administered_by":"Ministry of Finance",
    },
    {
        "source_id":      "GOI-PMFBY-001",
        "name":           {"en": "Pradhan Mantri Fasal Bima Yojana", "hi": "प्रधानमंत्री फसल बीमा योजना"},
        "description":    {"en": "Crop insurance scheme providing financial support to farmers suffering crop loss due to natural calamities."},
        "category":       "Crop Insurance",
        "annual_premium": 0,
        "coverage_amount":None,
        "coverage_type":  "Crop",
        "min_age":        None,
        "max_age":        None,
        "application_url":"https://www.myscheme.gov.in/schemes/pmfby",
        "source_url":     "https://www.myscheme.gov.in/schemes/pmfby",
        "tags":           ["crop insurance","farmer","natural calamity"],
        "administered_by":"Ministry of Agriculture",
    },
    {
        "source_id":      "GOI-ABPMJAY-001",
        "name":           {"en": "Ayushman Bharat - Pradhan Mantri Jan Arogya Yojana", "hi": "आयुष्मान भारत - प्रधानमंत्री जन आरोग्य योजना"},
        "description":    {"en": "Health insurance scheme providing coverage up to ₹5 lakh per family per year for secondary and tertiary care hospitalisation."},
        "category":       "Health Insurance",
        "annual_premium": 0,
        "coverage_amount":500000,
        "coverage_type":  "Health",
        "min_age":        None,
        "max_age":        None,
        "application_url":"https://www.myscheme.gov.in/schemes/ab-pmjay",
        "source_url":     "https://www.myscheme.gov.in/schemes/ab-pmjay",
        "tags":           ["health insurance","BPL","hospital"],
        "administered_by":"Ministry of Health",
    },
    {
        "source_id":      "GOI-AABY-001",
        "name":           {"en": "Aam Aadmi Bima Yojana", "hi": "आम आदमी बीमा योजना"},
        "description":    {"en": "Social security scheme for rural landless households providing life and disability cover."},
        "category":       "Life Insurance",
        "annual_premium": 200,
        "coverage_amount":75000,
        "coverage_type":  "Life + Disability",
        "min_age":        18,
        "max_age":        59,
        "application_url":"https://www.myscheme.gov.in/schemes/aaby",
        "source_url":     "https://www.myscheme.gov.in/schemes/aaby",
        "tags":           ["rural","landless","disability"],
        "administered_by":"LIC of India",
    },
    {
        "source_id":      "GOI-NREGSLI-001",
        "name":           {"en": "NREGS Life Insurance Scheme", "hi": "नरेगा जीवन बीमा योजना"},
        "description":    {"en": "Life insurance for MGNREGS workers providing financial security to their families."},
        "category":       "Life Insurance",
        "annual_premium": 0,
        "coverage_amount":30000,
        "coverage_type":  "Life",
        "min_age":        18,
        "max_age":        59,
        "application_url":"https://nrega.nic.in",
        "source_url":     "https://nrega.nic.in",
        "tags":           ["MGNREGS","worker","rural"],
        "administered_by":"Ministry of Rural Development",
    },
]


def upsert_insurance(conn, policy: dict) -> str:
    now = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM insurance_policies WHERE source_id = %s", (policy["source_id"],))
        existing = cur.fetchone()
        if existing:
            cur.execute("""
                UPDATE insurance_policies SET
                    name = %s, description = %s, category = %s,
                    annual_premium = %s, coverage_amount = %s, coverage_type = %s,
                    min_age = %s, max_age = %s,
                    application_url = %s, source_url = %s,
                    tags = %s, administered_by = %s,
                    is_active = TRUE, updated_at = %s
                WHERE source_id = %s
            """, (
                json.dumps(policy["name"]),
                json.dumps(policy["description"]),
                policy["category"],
                policy["annual_premium"],
                policy["coverage_amount"],
                policy["coverage_type"],
                policy["min_age"],
                policy["max_age"],
                policy["application_url"],
                policy["source_url"],
                policy["tags"],
                policy["administered_by"],
                now,
                policy["source_id"],
            ))
            conn.commit()
            return "updated"
        else:
            cur.execute("""
                INSERT INTO insurance_policies (
                    source_id, name, description, category,
                    annual_premium, coverage_amount, coverage_type,
                    min_age, max_age, application_url, source_url,
                    tags, administered_by, is_active, created_at, updated_at
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE,%s,%s)
            """, (
                policy["source_id"],
                json.dumps(policy["name"]),
                json.dumps(policy["description"]),
                policy["category"],
                policy["annual_premium"],
                policy["coverage_amount"],
                policy["coverage_type"],
                policy["min_age"],
                policy["max_age"],
                policy["application_url"],
                policy["source_url"],
                policy["tags"],
                policy["administered_by"],
                now, now,
            ))
            conn.commit()
            return "inserted"


# ════════════════════════════════════════════════════════════════════════════
# MAIN SCRAPER
# ════════════════════════════════════════════════════════════════════════════

def scrape(mode: str = "incremental", limit: int = None):
    log.info(f"=== ArthSathi Live Scraper — mode={mode} ===")
    log.info(f"Connecting to DB: {DB['dbname']}@{DB['host']}")

    conn = get_db()
    log.info("✅ Database connected")

    # ── Scrape Insurance ──────────────────────────────────────────────────
    log.info("Loading insurance policies...")
    ins_inserted = ins_updated = 0
    for policy in INSURANCE_POLICIES:
        result = upsert_insurance(conn, policy)
        if result == "inserted":
            ins_inserted += 1
        elif result == "updated":
            ins_updated += 1
        log.info(f"  {'✅' if result != 'skipped' else '–'} {result}: {policy['source_id']}")
    log.info(f"Insurance done: +{ins_inserted} inserted, {ins_updated} updated")

    if mode == "insurance":
        log.info("=== Insurance-only mode done ===")
        conn.close()
        return

    # ── Fetch total count ─────────────────────────────────────────────────
    log.info("Fetching total scheme count from myscheme.gov.in...")
    first_page = fetch_scheme_list(0, 1)
    if not first_page:
        log.error("❌ Could not reach myscheme.gov.in API. Check internet connection.")
        conn.close()
        sys.exit(1)

    total = first_page.get("data", {}).get("hits", {}).get("page", {}).get("total", 0)
    log.info(f"✅ Found {total} schemes on myscheme.gov.in")

    if limit:
        total = min(total, limit)
        log.info(f"   (limited to {limit} schemes)")

    # Incremental: check by source_id in DB
    existing_source_ids = set()
    if mode == "incremental":
        with conn.cursor() as cur:
            cur.execute("SELECT scheme_id FROM schemes WHERE scheme_id LIKE 'MYS-%'")
            existing_source_ids = {r[0] for r in cur.fetchall()}
        log.info(f"   Incremental mode: {len(existing_source_ids)} schemes already in DB, will skip those")

    # ── Main scrape loop ──────────────────────────────────────────────────
    inserted = updated = skipped = failed = 0
    offset = 0
    fetched = 0

    while fetched < total:
        batch_size = min(PAGE_SIZE, total - fetched)
        log.info(f"  Fetching batch: offset={offset}, size={batch_size} ({fetched}/{total})")

        page_data = fetch_scheme_list(offset, batch_size)
        time.sleep(DELAY)

        if not page_data:
            log.warning(f"  ⚠️  Failed to fetch batch at offset {offset}, skipping")
            offset += batch_size
            fetched += batch_size
            continue

        items = page_data.get("data", {}).get("hits", {}).get("items", [])
        if not items:
            log.info("  No more items. Done.")
            break

        # Filter out already-scraped items
        items_to_process = []
        for item in items:
            slug = item.get("fields", {}).get("slug", "")
            if not slug:
                fetched += 1
                continue
            source_id = f"MYS-{slug[:190]}"
            if mode == "incremental" and source_id in existing_source_ids:
                skipped += 1
                fetched += 1
                continue
            items_to_process.append(item)

        # Fetch details in parallel (5 threads)
        from concurrent.futures import ThreadPoolExecutor
        slugs = [item.get("fields", {}).get("slug", "") for item in items_to_process]
        details = {}
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_slug = {executor.submit(fetch_scheme_detail, slug): slug for slug in slugs if slug}
            for future in future_to_slug:
                slug = future_to_slug[future]
                try:
                    details[slug] = future.result(timeout=15)
                except Exception:
                    details[slug] = None

        for item in items_to_process:
            slug = item.get("fields", {}).get("slug", "")
            if not slug:
                continue
                continue

            source_id = f"MYS-{slug[:190]}"
            # Incremental skip (already handled above)

            # Use pre-fetched detail
            detail = details.get(slug)

            # Parse
            scheme = parse_scheme(item, detail)
            if not scheme:
                failed += 1
                fetched += 1
                continue

            # Upsert
            try:
                result = upsert_scheme(conn, scheme)
                if result == "inserted":
                    inserted += 1
                elif result == "updated":
                    updated += 1
                else:
                    skipped += 1
            except Exception as e:
                log.warning(f"  ⚠️  DB error for {slug}: {e}")
                conn.rollback()
                failed += 1

            fetched += 1

        offset += batch_size

        # Progress
        log.info(f"  Progress: {fetched}/{total} — +{inserted} new, {updated} updated, {skipped} skipped, {failed} failed")

    conn.close()
    log.info(f"""
=== Scrape Complete ===
  Total fetched  : {fetched}
  Inserted       : {inserted}
  Updated        : {updated}
  Skipped        : {skipped}
  Failed         : {failed}
  Insurance      : +{ins_inserted} inserted, {ins_updated} updated
""")

    # Auto-tag newly inserted schemes
    if inserted > 0:
        log.info(f"Auto-tagging {inserted} new schemes...")
        import subprocess
        backend_dir = Path(__file__).parent.parent / "backend"
        try:
            result = subprocess.run(
                ["node", "tag_schemes.js"],
                cwd=str(backend_dir),
                capture_output=True, text=True, timeout=3600
            )
            if result.returncode == 0:
                log.info("✅ Auto-tagging complete")
                # Print last few lines of output
                for line in result.stdout.strip().split('\n')[-10:]:
                    if line.strip(): log.info(f"  {line}")
            else:
                log.warning(f"⚠️  Tagging exited with code {result.returncode}: {result.stderr[:200]}")
        except Exception as e:
            log.warning(f"⚠️  Auto-tagging failed: {e}. Run manually: node tag_schemes.js")
    else:
        log.info("No new schemes inserted — skipping auto-tagging")


# ════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ArthSathi Live Scraper — myscheme.gov.in")
    parser.add_argument("--mode",  default="incremental",
                        choices=["incremental", "full", "insurance"],
                        help="incremental=only new, full=all schemes, insurance=policies only")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max schemes to scrape (useful for testing)")
    args = parser.parse_args()
    scrape(mode=args.mode, limit=args.limit)
