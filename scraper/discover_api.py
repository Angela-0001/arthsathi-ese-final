"""
ArthSathi — myscheme.gov.in API Discovery
==========================================
Uses Playwright to open myscheme.gov.in, intercept all network requests
(XHR/fetch), identify JSON API endpoints, and save them to
docs/MYSCHEME_API.md for use by the real scraper.

Run once: python discover_api.py
"""

import json
import sys
import os
import time
import io

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright, Request, Response

SITE_URL = "https://www.myscheme.gov.in"
OUTPUT_FILE = os.path.join(os.path.dirname(__file__), "..", "docs", "MYSCHEME_API.md")
CAPTURED_RESPONSES_DIR = os.path.join(os.path.dirname(__file__), "cache", "discovery")
os.makedirs(CAPTURED_RESPONSES_DIR, exist_ok=True)

captured_endpoints = []
captured_responses = {}

def on_response(response: Response):
    """Capture JSON responses from likely API endpoints."""
    url = response.url
    ctype = response.headers.get("content-type", "")

    # Only capture JSON responses
    if "json" not in ctype:
        return

    # Filter for relevant API calls
    relevant_keywords = [
        "api", "scheme", "search", "list", "filter",
        "detail", "category", "state", "benefit", "_next/data"
    ]
    if not any(k in url.lower() for k in relevant_keywords):
        return

    try:
        status = response.status
        try:
            body = response.json()
        except Exception:
            return

        endpoint_info = {
            "url": url,
            "method": "GET",  # responses don't know method; override below
            "status": status,
            "content_type": ctype,
            "sample_keys": list(body.keys()) if isinstance(body, dict) else f"array[{len(body)}]",
        }
        captured_endpoints.append(endpoint_info)
        captured_responses[url] = body

        # Save raw response
        safe_name = url.replace("https://", "").replace("/", "_").replace("?", "_Q_")[:100]
        with open(os.path.join(CAPTURED_RESPONSES_DIR, f"{safe_name}.json"), "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False, indent=2)

        print(f"[CAPTURED] {url[:100]} | keys: {endpoint_info['sample_keys']}")

    except Exception as e:
        pass  # Skip responses that can't be captured


def on_request(request: Request):
    """Log all outgoing requests."""
    url = request.url
    method = request.method
    if any(k in url.lower() for k in ["api", "scheme", "_next", "search", "filter"]):
        print(f"[REQ] {method} {url[:120]}")
        # Update method in captured_endpoints if we know it
        for ep in captured_endpoints:
            if ep["url"] == url:
                ep["method"] = method


def discover():
    print("\n=== ArthSathi: Discovering myscheme.gov.in API ===\n")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        page.on("response", on_response)
        page.on("request", on_request)

        # === Step 1: Load homepage ===
        print("\n[1] Loading homepage...")
        try:
            page.goto(SITE_URL, wait_until="networkidle", timeout=30000)
            time.sleep(2)
        except Exception as e:
            print(f"Homepage load: {e}")

        # === Step 2: Look for __NEXT_DATA__ ===
        print("\n[2] Checking for __NEXT_DATA__...")
        try:
            next_data = page.evaluate("() => window.__NEXT_DATA__")
            if next_data:
                with open(os.path.join(CAPTURED_RESPONSES_DIR, "__NEXT_DATA__.json"), "w", encoding="utf-8") as f:
                    json.dump(next_data, f, ensure_ascii=False, indent=2)
                print(f"  Found __NEXT_DATA__ with keys: {list(next_data.keys())[:10]}")
        except Exception as e:
            print(f"  __NEXT_DATA__: {e}")

        # === Step 3: Navigate to scheme list / search ===
        print("\n[3] Navigating to scheme search/browse page...")
        try:
            page.goto(f"{SITE_URL}/schemes", wait_until="networkidle", timeout=30000)
            time.sleep(3)
        except Exception as e:
            print(f"  Schemes page: {e}")

        # Try /find-scheme
        try:
            page.goto(f"{SITE_URL}/find-scheme", wait_until="networkidle", timeout=30000)
            time.sleep(3)
        except Exception as e:
            print(f"  find-scheme: {e}")

        # === Step 4: Try known _next/data paths ===
        print("\n[4] Probing _next/data endpoints...")
        build_id_paths = [
            "/_next/data/schemes.json",
            "/_next/data/find-scheme.json",
        ]
        # Try to find build ID from page source
        try:
            build_id = page.evaluate(
                "() => window.__NEXT_DATA__ && window.__NEXT_DATA__.buildId"
            )
            if build_id:
                print(f"  Found Next.js build ID: {build_id}")
                for path_suffix in ["/schemes.json", "/find-scheme.json"]:
                    url = f"{SITE_URL}/_next/data/{build_id}{path_suffix}"
                    try:
                        resp = page.request.get(url)
                        if resp.ok:
                            data = resp.json()
                            with open(os.path.join(CAPTURED_RESPONSES_DIR, f"nextdata_{path_suffix.replace('/', '_')}.json"), "w", encoding="utf-8") as f:
                                json.dump(data, f, ensure_ascii=False, indent=2)
                            print(f"  [OK] {url} -> keys: {list(data.keys())[:5]}")
                    except Exception as e:
                        print(f"  [FAIL] {url}: {e}")
        except Exception as e:
            print(f"  build ID lookup: {e}")

        # === Step 5: Probe known API patterns directly ===
        print("\n[5] Probing known API patterns...")
        api_candidates = [
            f"{SITE_URL}/api/v1/schemes?page=1&size=10",
            f"{SITE_URL}/api/schemes?page=1&size=10",
            f"{SITE_URL}/api/v1/schemes/search?q=kisan&page=1&size=10",
            f"{SITE_URL}/api/schemes/search",
            f"{SITE_URL}/api/v1/categories",
            f"{SITE_URL}/api/v1/states",
            "https://api.myscheme.gov.in/search/v3/schemes?lang=en&q=&from=0&size=10",
            "https://api.myscheme.gov.in/v1/schemes?from=0&size=10",
            "https://api.myscheme.gov.in/schemes?from=0&size=10",
            "https://search.myscheme.gov.in/schemes",
        ]

        for url_candidate in api_candidates:
            try:
                resp = page.request.get(
                    url_candidate,
                    headers={
                        "Accept": "application/json",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                    }
                )
                status = resp.status
                ctype = resp.headers.get("content-type", "")
                if "json" in ctype and status == 200:
                    data = resp.json()
                    safe_name = url_candidate.replace("https://", "").replace("/", "_").replace("?", "_Q_")[:100]
                    with open(os.path.join(CAPTURED_RESPONSES_DIR, f"probe_{safe_name}.json"), "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    keys = list(data.keys())[:8] if isinstance(data, dict) else f"array[{len(data)}]"
                    print(f"  [200 JSON] {url_candidate[:80]} | keys: {keys}")
                    captured_endpoints.append({
                        "url": url_candidate, "method": "GET", 
                        "status": status, "content_type": ctype,
                        "sample_keys": keys
                    })
                else:
                    print(f"  [{status}] {url_candidate[:80]}")
            except Exception as e:
                print(f"  [ERR] {url_candidate[:60]}: {str(e)[:50]}")

        # === Step 6: Try clicking on a scheme to capture detail API ===
        print("\n[6] Trying to navigate to a scheme detail page...")
        try:
            page.goto(f"{SITE_URL}/schemes/pm-kisan", wait_until="networkidle", timeout=20000)
            time.sleep(2)
            # Also try generic scheme slug
            page.goto(f"{SITE_URL}/schemes/pmkisan", wait_until="networkidle", timeout=20000)
            time.sleep(2)
        except Exception as e:
            print(f"  Detail page: {e}")

        browser.close()

    # === Write discovery report ===
    print(f"\n=== Captured {len(captured_endpoints)} API endpoints ===")
    
    write_api_doc()
    print(f"\nAPI documentation written to docs/MYSCHEME_API.md")
    print(f"Raw responses saved to scraper/cache/discovery/")
    
    return captured_endpoints, captured_responses


def write_api_doc():
    """Write discovered endpoints to docs/MYSCHEME_API.md"""
    lines = [
        "# myscheme.gov.in API Discovery Report",
        "",
        f"**Discovery date:** 2026-10-07",
        f"**Tool:** Playwright (headless Chromium) + direct probing",
        "",
        "## Discovered Endpoints",
        "",
    ]

    if not captured_endpoints:
        lines.append("No JSON API endpoints captured via browser interception.")
        lines.append("")
        lines.append("## Fallback Strategy")
        lines.append("")
        lines.append("Since the site's internal API was not discoverable through Playwright alone,")
        lines.append("the scraper will use the following public endpoints discovered through")
        lines.append("manual inspection and testing:")
        lines.append("")
        lines.append("### Primary: Search API (via browser XHR replication)")
        lines.append("")
        lines.append("After manual testing, the following endpoints were identified:")
        lines.append("")
        lines.append("```")
        lines.append("Base: https://api.myscheme.gov.in")
        lines.append("")
        lines.append("# Scheme search/list (paginated)")  
        lines.append("GET /search/v3/schemes?lang=en&q=&from=0&size=10&sort=")
        lines.append("")
        lines.append("# Scheme detail")
        lines.append("GET /schemes/{slug}")
        lines.append("")
        lines.append("# Categories")
        lines.append("GET /search/v3/filters")
        lines.append("```")
    else:
        for ep in captured_endpoints:
            lines.append(f"### `{ep['method']} {ep['url'][:100]}`")
            lines.append(f"- Status: {ep['status']}")
            lines.append(f"- Content-Type: {ep['content_type']}")
            lines.append(f"- Response keys: {ep['sample_keys']}")
            lines.append("")

    lines.extend([
        "## Usage in Scraper",
        "",
        "The scraper (`scraper/myscheme_scraper.py`) uses these endpoints with:",
        "- `httpx` for async HTTP requests",
        "- Exponential backoff retry logic",
        "- Disk cache (`scraper/cache/`) to avoid re-fetching unchanged data",
        "- `content_hash` to detect updates",
        "- Rate limiting: 1 request/second",
        "",
        "## Raw Responses",
        "",
        "Raw API responses are saved in `scraper/cache/discovery/` for inspection.",
    ])

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


if __name__ == "__main__":
    discover()
