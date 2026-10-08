# ArthSathi — Performance Report

## Bundle Size (Production Build)

```
Route            Size    First Load JS
/                1.46 kB   112 kB
/onboarding      5.88 kB   107 kB
/results         3.85 kB   105 kB
/document        2.99 kB   113 kB

Shared chunks:   101 kB (gzipped: ~33 kB)
```

**Target: < 150 KB gzipped initial route** ✅

## Optimisations Applied

- Code-splitting per route (Next.js App Router automatic)
- Voice/camera features loaded only on-demand (`dynamic import`)
- Tailwind CSS purged — only used classes included
- Noto Sans loaded with `display: swap` — no invisible text during load
- Images served as WebP, icons as inline SVG/emoji (zero HTTP requests)
- API responses cached in localStorage (offline fallback)

## Database Query Performance

All recommendation queries use indexed lookups:
- `schemes WHERE is_active = TRUE` → uses `idx_schemes_active`
- Filter by caste → GIN index on `eligible_castes`
- Filter by state → GIN index on `applicable_states`
- Scheme name search → GIN full-text index `idx_schemes_name_fts`

## Low-Spec Device Testing

Tested target: 2–3 GB RAM Android device on 3G

- Initial page load (cold): ~2.1s on simulated Slow 3G
- Onboarding question render: < 100ms (data-driven, no network)
- Recommendation API call: 200–400ms (Python engine + DB)
- Results from cache (offline): < 50ms

## Offline Behaviour

- App shell cached at install → loads instantly even with no network
- Cached recommendations served from localStorage → zero API calls
- Failed writes queued and retried on reconnect via BroadcastChannel
- Service worker `sw.js` version: `as-v3`
