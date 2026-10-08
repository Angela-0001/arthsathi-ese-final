"""
Use Playwright to intercept the actual API calls made by myscheme.gov.in,
replicate exact headers/tokens, and save them for use in the scraper.
"""
import sys, io, json, os, time
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from playwright.sync_api import sync_playwright

SITE_URL = "https://www.myscheme.gov.in"
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache", "intercepted")
os.makedirs(CACHE_DIR, exist_ok=True)

api_calls = []
response_bodies = {}

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 900},
            extra_http_headers={
                "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
            }
        )

        # Intercept all responses
        def on_response(response):
            url = response.url
            status = response.status
            ctype = response.headers.get("content-type", "")
            
            if "json" not in ctype:
                return
            if status != 200:
                return
            
            try:
                body = response.json()
                body_str = json.dumps(body)
                if len(body_str) < 100:
                    return
                
                req_headers = {}
                try:
                    req_headers = response.request.headers
                except:
                    pass
                
                call_info = {
                    "url": url,
                    "method": response.request.method,
                    "status": status,
                    "request_headers": dict(req_headers),
                    "response_keys": list(body.keys())[:8] if isinstance(body, dict) else f"array[{min(len(body),5)}]",
                    "response_size": len(body_str),
                }
                api_calls.append(call_info)
                response_bodies[url] = body
                
                safe = url.replace("https://","").replace("/","_").replace("?","_Q_").replace("&","_A_")[:100]
                with open(os.path.join(CACHE_DIR, f"{safe}.json"), "w", encoding="utf-8") as f:
                    json.dump(body, f, ensure_ascii=False, indent=2)
                
                print(f"[CAPTURED {len(body_str)}B] {url[:100]}")
                print(f"  keys: {call_info['response_keys']}")
                
            except Exception as e:
                pass

        page = context.new_page()
        page.on("response", on_response)

        # 1. Homepage
        print("\n=== Navigating homepage ===")
        page.goto(SITE_URL, wait_until="networkidle", timeout=30000)
        time.sleep(2)

        # 2. find-scheme page (main search page)
        print("\n=== Navigating find-scheme ===")
        try:
            page.goto(f"{SITE_URL}/find-scheme", wait_until="networkidle", timeout=30000)
            time.sleep(3)
        except Exception as e:
            print(f"  Error: {e}")

        # 3. Scroll down to trigger lazy loads
        page.keyboard.press("End")
        time.sleep(2)
        page.keyboard.press("End")
        time.sleep(2)

        # 4. Try searching
        print("\n=== Trying search interaction ===")
        try:
            # Look for search input
            inputs = page.query_selector_all("input[type=search], input[placeholder*='Search'], input[placeholder*='search'], input[class*='search']")
            print(f"  Found {len(inputs)} search inputs")
            if inputs:
                inputs[0].click()
                inputs[0].fill("farmer")
                inputs[0].press("Enter")
                time.sleep(3)
        except Exception as e:
            print(f"  Search error: {e}")

        # 5. Navigate to a known scheme
        print("\n=== Navigating to scheme detail ===")
        try:
            page.goto(f"{SITE_URL}/schemes/pm-kisan", wait_until="networkidle", timeout=20000)
            time.sleep(3)
        except:
            pass
        try:
            page.goto(f"{SITE_URL}/schemes/pradhan-mantri-kisan-samman-nidhi", wait_until="networkidle", timeout=20000)
            time.sleep(2)
        except:
            pass

        # 6. Try filter/category navigation
        print("\n=== Navigating categories ===")
        try:
            page.goto(f"{SITE_URL}/find-scheme?category=Agriculture", wait_until="networkidle", timeout=20000)
            time.sleep(3)
            page.goto(f"{SITE_URL}/find-scheme?state=Maharashtra", wait_until="networkidle", timeout=20000)
            time.sleep(3)
        except Exception as e:
            print(f"  Category nav error: {e}")

        browser.close()

    # Save full report
    print(f"\n=== Total API calls captured: {len(api_calls)} ===\n")
    
    report = {
        "total_captured": len(api_calls),
        "endpoints": api_calls,
    }
    with open(os.path.join(CACHE_DIR, "_SUMMARY.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    
    for call in api_calls:
        print(f"\nURL: {call['url']}")
        print(f"  Method: {call['method']}, Size: {call['response_size']}B")
        print(f"  Keys: {call['response_keys']}")
        # Print auth headers
        auth_headers = {k: v for k, v in call['request_headers'].items() 
                       if any(kw in k.lower() for kw in ['auth','token','key','cookie','x-'])}
        if auth_headers:
            print(f"  Auth headers: {list(auth_headers.keys())}")

    return api_calls, response_bodies

if __name__ == "__main__":
    run()
