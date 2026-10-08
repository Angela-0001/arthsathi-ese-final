# myscheme.gov.in API Documentation

**Discovered:** 2026-10-07 via Playwright browser interception  
**Total schemes available:** 5,098  
**Pagination:** 510 pages × 10 items = 5,098 total

---

## Primary Endpoints

### 1. Scheme List / Search (Paginated)

**URL Pattern:**
```
GET https://www.myscheme.gov.in/api/apisetu/search/schemes/facets?lang=en&from=0&size=10
```

**Pagination parameters:**
- `from` — offset (0-based), increments by `size`
- `size` — page size (default 10, tested up to 50)
- `lang` — language code (en, hi, mr, ta, te, bn, or, as, gu, kn, ml, pa, ur)
- `q` — optional JSON filter array (URL-encoded)

**Filter format (q parameter):**
```json
[{"identifier":"level","value":"Central"}]
[{"identifier":"state","value":"Maharashtra"}]
[{"identifier":"schemeCategory","value":"Agriculture,Rural & Environment"}]
```

**Response structure:**
```json
{
  "status": "Success",
  "data": {
    "summary": {
      "total": 5098,
      "query": "",
      "appliedFilters": []
    },
    "hits": {
      "page": {
        "from": 0, "pageNumber": 0, "size": 10,
        "total": 5098, "totalPages": 510
      },
      "items": [
        {
          "id": "thg0IZ4B5uF80_MGlmo1",
          "fields": {
            "slug": "rtif",
            "schemeName": "Right To Information Fellowship",
            "schemeShortTitle": "RTIF",
            "briefDescription": "...",
            "level": "Central",
            "nodalMinistryName": "Ministry Of Personnel...",
            "schemeCategory": ["Education, Learning & Jobs"],
            "beneficiaryState": [],
            "tags": [],
            "schemeFor": "Individual",
            "priority": 1,
            "schemeCloseDate": ""
          }
        }
      ]
    },
    "facets": [...]
  }
}
```

### 2. Scheme Detail (by slug)

```
GET https://www.myscheme.gov.in/api/apisetu/schemes?slug={slug}&lang=en
```

**Response keys (inside `data`):**
- `_id` — MongoDB ObjectId (used for sub-endpoints)
- `en` — English content:
  - `applicationProcess` — rich text array (ol_list, ul_list, paragraph nodes)
  - `benefitDescription` — rich text
  - `eligibilityCriteria` — rich text array
  - `exclusionCriteria`
  - `faq` 
- `tags` — array of tag strings
- `benefitTypes` — array
- `state` — state name or empty for central
- `level` — "Central" / "State"
- `ministry` / `nodalMinistryName`
- `schemeCategory` — array of category strings
- `targetBeneficiaries` — array (e.g. ["Women", "Farmer", "SC/ST"])
- `ageGroup` — e.g. "18-40 years"
- `gender` — e.g. "Female"
- `caste` — array e.g. ["SC", "ST", "OBC"]
- `incomeGroup` — e.g. "Below 1 Lakh"
- `maritalStatus`
- `disability`
- `residence` — "Rural" / "Urban" / "Rural and Urban"

### 3. Sub-endpoints (by `_id`)

```
GET https://www.myscheme.gov.in/api/apisetu/schemes/{_id}/faqs?lang=en
GET https://www.myscheme.gov.in/api/apisetu/schemes/{_id}/documents?lang=en
GET https://api.myscheme.gov.in/schemes/v6/public/schemes/{_id}/applicationchannel
```

---

## Request Headers Required

The API is accessed via a proxy at `www.myscheme.gov.in/api/apisetu/` which passes through without auth headers. Plain `httpx` with browser-like headers works:

```python
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.myscheme.gov.in/",
    "Accept-Language": "en-IN,en;q=0.9",
}
```

## Rate Limiting

- 1 request/second is safe
- No observed rate limiting at this speed
- Cache all responses to disk to avoid re-fetching
