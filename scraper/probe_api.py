"""
Direct probe of myscheme.gov.in API endpoints.
Tries every known/guessed pattern and reports what works.
"""
import sys, io, json, os
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import httpx, time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Referer": "https://www.myscheme.gov.in/",
    "Origin": "https://www.myscheme.gov.in",
}

BUILD_ID = "AiTVSiyzLGiBWbRbB_ubL"

candidates = [
    # Known CDN / API subdomains
    f"https://cdn.myscheme.in/_next/data/{BUILD_ID}/en.json",
    f"https://cdn.myscheme.in/_next/data/{BUILD_ID}/en/schemes.json",
    f"https://www.myscheme.gov.in/_next/data/{BUILD_ID}/en/find-scheme.json",
    f"https://www.myscheme.gov.in/_next/data/{BUILD_ID}/en/schemes.json",
    # Direct API
    "https://api.myscheme.gov.in/search/v3/schemes?lang=en&q=&from=0&size=5",
    "https://api.myscheme.gov.in/search/v3/schemes?lang=en&from=0&size=5",
    "https://api.myscheme.gov.in/schemes?from=0&size=5",
    "https://api.myscheme.gov.in/v1/schemes?from=0&size=5",
    "https://api.myscheme.gov.in/search/v2/schemes?q=&from=0&size=5",
    "https://api.myscheme.gov.in/search/v1/schemes?q=&from=0&size=5",
    # myscheme search API
    "https://www.myscheme.gov.in/api/v1/schemes?page=1&limit=5",
    "https://www.myscheme.gov.in/api/schemes?page=1&limit=5",
    "https://www.myscheme.gov.in/api/search?q=kisan&lang=en",
    # ElasticSearch proxy patterns
    "https://api.myscheme.gov.in/es/schemes/_search",
    "https://search.myscheme.gov.in/schemes?q=kisan&from=0&size=5",
    # Gov CDN static JSON
    "https://cdn.myscheme.in/data/schemes.json",
    "https://cdn.myscheme.in/schemes.json",
    # National Portal
    "https://www.myscheme.gov.in/schemes",
]

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache", "discovery")
os.makedirs(CACHE_DIR, exist_ok=True)

working = []

with httpx.Client(headers=HEADERS, follow_redirects=True, timeout=15) as client:
    for url in candidates:
        try:
            r = client.get(url)
            ctype = r.headers.get("content-type", "")
            size = len(r.content)
            print(f"[{r.status_code}] {url[:90]} | {ctype[:40]} | {size}B")
            
            if r.status_code == 200 and "json" in ctype and size > 200:
                try:
                    data = r.json()
                    safe = url.replace("https://", "").replace("/", "_").replace("?","_Q_")[:90]
                    fpath = os.path.join(CACHE_DIR, f"probe_{safe}.json")
                    with open(fpath, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, indent=2)
                    top_keys = list(data.keys())[:6] if isinstance(data, dict) else f"array[{len(data)}]"
                    print(f"    -> SAVED. Top keys: {top_keys}")
                    working.append({"url": url, "keys": top_keys})
                except:
                    print("    -> JSON parse failed")
            time.sleep(0.3)
        except Exception as e:
            print(f"[ERR] {url[:80]}: {e}")

print(f"\n\n=== {len(working)} working JSON endpoints ===")
for w in working:
    print(f"  {w['url']}")
    print(f"    keys: {w['keys']}")
