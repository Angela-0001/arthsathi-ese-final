"""
ArthSathi — Dynamic Web Scraper (run_scraper.py)
=================================================

Scrapes scheme data from myscheme.gov.in internal API, stores it in
PostgreSQL database 'arthsathifinal' using a simplified schema, and
re-runs every 24 hours via APScheduler.

Usage:
    python run_scraper.py

No command-line arguments required.
"""

import sys
import io

if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import json
import time
import logging
import datetime
from typing import Optional, Any

import httpx
import psycopg2
import psycopg2.extras

from apscheduler.schedulers.background import BackgroundScheduler

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────

DB_CONFIG = {
    "host":     "127.0.0.1",
    "port":     5432,
    "dbname":   "arthsathifinal",
    "user":     "postgres",
    "password": "universe",
}

BASE_URL      = "https://www.myscheme.gov.in/api/apisetu"
PAGE_SIZE     = 50      # 50 items per page
MAX_PAGES     = 5       # 5 pages x 50 = 250 schemes per run
REQUEST_DELAY = 1.0     # polite rate limit (seconds)
MAX_RETRIES   = 3
BACKOFF_BASE  = 2

HEADERS = {
    "User-Agent": "ArthSathiBot/2.0 (public data aggregator for rural welfare; "
                  "contact: arthsathi@example.in)",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.myscheme.gov.in/",
    "Origin": "https://www.myscheme.gov.in",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("run_scraper")

# ─────────────────────────────────────────────────────────────────────────────
# Database setup
# ─────────────────────────────────────────────────────────────────────────────

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS schemes (
    source_id        VARCHAR PRIMARY KEY,
    name             JSONB,
    description      JSONB,
    ministry         TEXT,
    category         TEXT,
    is_active        BOOLEAN DEFAULT TRUE,
    last_scraped_at  TIMESTAMP,
    application_url  TEXT
);
"""


def get_conn():
    """Open and return a new DB connection."""
    return psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.DictCursor)


def ensure_table(conn):
    """Create the schemes table if it does not already exist."""
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
    conn.commit()
    log.info("Table 'schemes' is ready.")


# ─────────────────────────────────────────────────────────────────────────────
# HTTP helper (mirrors fetch_json in myscheme_scraper.py, without disk cache)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_json(client: httpx.Client, url: str, params: dict = None) -> Optional[dict]:
    """
    Fetch JSON from the given URL with retry/backoff logic.
    Always fetches fresh data (no disk cache) so every run reflects live data.
    """
    params = params or {}
    for attempt in range(MAX_RETRIES):
        try:
            resp = client.get(url, params=params, timeout=30)
            resp.raise_for_status()
            data = resp.json()

            if isinstance(data, dict) and data.get("status") == "Success":
                return data
            if isinstance(data, dict) and data.get("statusCode") == 200:
                return data

            log.warning(f"Non-success API response from {url}: {str(data)[:200]}")
            return None

        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429:
                wait = BACKOFF_BASE ** (attempt + 2)
                log.warning(f"Rate-limited. Waiting {wait}s ...")
                time.sleep(wait)
            elif exc.response.status_code >= 500:
                wait = BACKOFF_BASE ** attempt
                log.warning(f"Server error {exc.response.status_code}. Retry {attempt + 1} in {wait}s")
                time.sleep(wait)
            else:
                log.error(f"HTTP {exc.response.status_code} for {url}")
                return None
        except Exception as exc:
            wait = BACKOFF_BASE ** attempt
            log.warning(f"Request error ({exc}). Retry {attempt + 1} in {wait}s")
            time.sleep(wait)

    log.error(f"All {MAX_RETRIES} retries exhausted for {url}")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Rich-text extractor (mirrors extract_text_from_rich in myscheme_scraper.py)
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_rich(obj: Any) -> str:
    """
    Recursively extract plain text from myscheme's editor.js rich-text nodes.
    Handles paragraph, list, text node types.
    """
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj.strip()
    if isinstance(obj, list):
        return "\n".join(filter(None, [extract_text_from_rich(item) for item in obj]))
    if isinstance(obj, dict):
        text_val = obj.get("text", "")
        children = obj.get("children", [])
        content  = obj.get("content", [])
        if text_val:
            return text_val.strip()
        if children:
            return extract_text_from_rich(children)
        if content:
            return extract_text_from_rich(content)
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# Category inference (mirrors infer_category in myscheme_scraper.py)
# ─────────────────────────────────────────────────────────────────────────────

def infer_category(scheme_categories: list, tags: list, name: str) -> str:
    """Map myscheme category strings to a simplified category label."""
    text = " ".join((scheme_categories or []) + (tags or []) + [name]).lower()
    if any(w in text for w in ["agri", "rural", "farmer", "kisan", "crop", "irrigation", "fishery"]):
        return "agriculture"
    if any(w in text for w in ["health", "medical", "hospital", "ayushman", "arogya", "sanitation"]):
        return "health"
    if any(w in text for w in ["education", "scholarship", "school", "college", "skill", "training"]):
        return "education"
    if any(w in text for w in ["housing", "house", "shelter", "awas"]):
        return "housing"
    if any(w in text for w in ["employ", "job", "labour", "wage", "rozgar", "livelihood"]):
        return "employment"
    if any(w in text for w in ["women", "mahila", "female", "girl", "beti", "widow"]):
        return "women_welfare"
    if any(w in text for w in ["disab", "divyang", "handicap", "pwd"]):
        return "disability"
    if any(w in text for w in ["insurance", "bima"]):
        return "insurance"
    if any(w in text for w in ["pension", "social security", "old age", "senior"]):
        return "social_security"
    return "other"


# ─────────────────────────────────────────────────────────────────────────────
# Scheme parser (simplified version of parse_scheme_detail in myscheme_scraper.py)
# ─────────────────────────────────────────────────────────────────────────────

def parse_scheme_detail(detail: dict, list_fields: dict) -> dict:
    """
    Extract only the columns needed by the simplified schema:
      source_id, name (JSONB), description (JSONB),
      ministry, category, is_active, application_url.

    Logic mirrors parse_scheme_detail in myscheme_scraper.py.
    """
    data       = detail.get("data", {})
    en_content = data.get("en", {})
    hi_content = data.get("hi", {})

    slug = list_fields.get("slug") or data.get("slug", "")

    # Bilingual name
    name_en = list_fields.get("schemeName") or data.get("schemeName", "")
    name_hi = (
        hi_content.get("schemeName")
        or data.get("hi", {}).get("schemeName")
        or name_en
    )

    # Description: prefer briefDescription; fall back to benefit text
    brief_en = list_fields.get("briefDescription") or ""
    if not brief_en:
        benefit_raw = extract_text_from_rich(en_content.get("benefitDescription", []))
        brief_en = benefit_raw[:500] if benefit_raw else ""

    brief_hi = extract_text_from_rich(hi_content.get("benefitDescription", []))
    brief_hi = brief_hi[:500] if brief_hi else ""

    # Ministry
    ministry = (
        list_fields.get("nodalMinistryName")
        or data.get("nodalMinistryName", "")
        or ""
    )

    # Category
    categories = list_fields.get("schemeCategory") or data.get("schemeCategory") or []
    if isinstance(categories, str):
        categories = [categories]
    tags     = list_fields.get("tags") or data.get("tags") or []
    category = infer_category(categories, tags, name_en)

    return {
        "source_id":       slug,
        "name":            {"en": name_en, "hi": name_hi},
        "description":     {"en": brief_en, "hi": brief_hi},
        "ministry":        ministry[:400] if ministry else None,
        "category":        category,
        "application_url": f"https://www.myscheme.gov.in/schemes/{slug}",
    }


# ─────────────────────────────────────────────────────────────────────────────
# Database upsert
# ─────────────────────────────────────────────────────────────────────────────

UPSERT_SQL = """
INSERT INTO schemes (
    source_id, name, description, ministry, category,
    is_active, last_scraped_at, application_url
) VALUES (
    %(source_id)s,
    %(name)s::jsonb,
    %(description)s::jsonb,
    %(ministry)s,
    %(category)s,
    TRUE,
    %(last_scraped_at)s,
    %(application_url)s
)
ON CONFLICT (source_id) DO UPDATE SET
    name            = EXCLUDED.name,
    description     = EXCLUDED.description,
    ministry        = EXCLUDED.ministry,
    category        = EXCLUDED.category,
    is_active       = TRUE,
    last_scraped_at = EXCLUDED.last_scraped_at,
    application_url = EXCLUDED.application_url;
"""


def upsert_scheme(conn, scheme: dict, now: datetime.datetime) -> str:
    """
    Upsert a single scheme row. Returns 'inserted' or 'updated'.
    """
    with conn.cursor() as cur:
        # Check existence to distinguish insert vs update for logging
        cur.execute("SELECT 1 FROM schemes WHERE source_id = %s", (scheme["source_id"],))
        exists = cur.fetchone() is not None

        cur.execute(UPSERT_SQL, {
            "source_id":       scheme["source_id"],
            "name":            json.dumps(scheme["name"],        ensure_ascii=False),
            "description":     json.dumps(scheme["description"], ensure_ascii=False),
            "ministry":        scheme["ministry"],
            "category":        scheme["category"],
            "last_scraped_at": now,
            "application_url": scheme["application_url"],
        })
    conn.commit()
    return "updated" if exists else "inserted"


# ─────────────────────────────────────────────────────────────────────────────
# Main scrape function
# ─────────────────────────────────────────────────────────────────────────────

def run_scrape():
    """
    Fetch up to MAX_PAGES * PAGE_SIZE schemes from myscheme.gov.in and upsert
    them into PostgreSQL. Called once at startup and then every 24 hours.
    """
    start_time = time.time()
    log.info("=== ArthSathi Scraper: run starting ===")

    inserted  = 0
    updated   = 0
    failed    = 0

    conn = get_conn()
    ensure_table(conn)
    now  = datetime.datetime.utcnow()

    with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=30) as client:
        for page_num in range(MAX_PAGES):
            current_from = page_num * PAGE_SIZE
            log.info(f"[PAGE {page_num + 1}/{MAX_PAGES}] Fetching from={current_from} ...")

            list_resp = fetch_json(
                client,
                f"{BASE_URL}/search/schemes/facets",
                params={"lang": "en", "from": current_from, "size": PAGE_SIZE},
            )

            if not list_resp:
                log.error(f"Failed to fetch page {page_num + 1} (from={current_from}). Skipping.")
                failed += 1
                continue

            hits_data = list_resp.get("data", {}).get("hits", {})
            page_info = hits_data.get("page", {})
            items     = hits_data.get("items", [])
            total     = page_info.get("total", 0)

            if not items:
                log.info(f"No items returned at from={current_from} (total={total}). Stopping early.")
                break

            log.info(f"  Got {len(items)} items (total available: {total})")

            for item in items:
                fields = item.get("fields", {})
                slug   = fields.get("slug", "")

                if not slug:
                    log.warning("Skipping item with no slug.")
                    failed += 1
                    continue

                time.sleep(REQUEST_DELAY)

                detail_resp = fetch_json(
                    client,
                    f"{BASE_URL}/schemes",
                    params={"slug": slug, "lang": "en"},
                )

                if not detail_resp:
                    log.warning(f"Could not fetch detail for slug={slug}")
                    failed += 1
                    continue

                try:
                    scheme = parse_scheme_detail(detail_resp, fields)
                    status = upsert_scheme(conn, scheme, now)
                    if status == "inserted":
                        inserted += 1
                    else:
                        updated += 1

                    total_done = inserted + updated
                    if total_done % 25 == 0:
                        log.info(f"  Progress: {total_done} done (+{inserted} new, {updated} updated, {failed} failed)")

                except Exception as exc:
                    log.error(f"Parse/upsert error for slug={slug}: {exc}")
                    failed += 1
                    try:
                        conn.rollback()
                    except Exception:
                        pass

            # Stop if we've already seen everything available
            if current_from + PAGE_SIZE >= total:
                log.info(f"Reached total={total}. All available schemes fetched.")
                break

    conn.close()
    duration = round(time.time() - start_time, 1)

    log.info(
        f"=== Scraper run complete in {duration}s | "
        f"inserted={inserted}, updated={updated}, failed={failed} ==="
    )
    return {"inserted": inserted, "updated": updated, "failed": failed, "duration_secs": duration}


# ─────────────────────────────────────────────────────────────────────────────
# Entry point — run once immediately, then schedule every 24 hours
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Run immediately on startup
    run_scrape()

    # Schedule recurring runs every 24 hours
    scheduler = BackgroundScheduler()
    scheduler.add_job(run_scrape, "interval", hours=24)
    scheduler.start()
    log.info("Scheduler started — next run in 24 hours. Press Ctrl+C to stop.")

    try:
        while True:
            time.sleep(60)
    except (KeyboardInterrupt, SystemExit):
        log.info("Shutting down scheduler ...")
        scheduler.shutdown()
        log.info("Done.")
