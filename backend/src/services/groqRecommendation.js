/**
 * ArthSathi — Groq + Multi-Source Live Scheme Search
 *
 * Sources:
 *   1. myscheme.gov.in   — central/state govt schemes aggregator
 *   2. janparichay.gov.in — identity + welfare portals
 *   3. india.gov.in       — National Portal of India scheme listings
 *   4. pmindia.gov.in     — PM schemes & flagship programmes
 *   5. Static curated list of major welfare schemes (fallback / supplement)
 *
 * Flow:
 * 1. Get user profile from DB
 * 2. Ask Groq to generate search filters for myscheme.gov.in
 * 3. Fetch from myscheme.gov.in (primary)
 * 4. Fetch from supplementary sources in parallel
 * 5. Merge, deduplicate, ask Groq to rank by relevance
 * 6. Return only genuinely relevant schemes — no synthetic data
 */

'use strict';

const Groq   = require('groq-sdk');
const https  = require('https');
const http   = require('http');
const { query } = require('../db');
const { fetchUserProfile } = require('../services/profileService');

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY || 'dummy-key-to-prevent-crash' });
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// ─── In-memory cache ──────────────────────────────────────────────────────────
// Stores scheme and insurance results per user for 1 hour.
// Keyed as "schemes:<userId>" or "insurance:<userId>"
const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

/** Call this if you want to force-refresh a user's recommendations (e.g. after profile update) */
function invalidateUserCache(userId) {
  _cache.delete(`schemes:${userId}`);
  _cache.delete(`insurance:${userId}`);
}

const MYSCHEME_BASE = 'https://www.myscheme.gov.in/api/apisetu';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.myscheme.gov.in/',
};

// ─── HTTP helper (supports both http and https) ───────────────────────────────
function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { ...HEADERS, ...extraHeaders }, timeout: 12000 }, (res) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return httpGet(res.headers.location, extraHeaders).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + data.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── Source 1: Search myscheme.gov.in ────────────────────────────────────────
async function searchMyScheme(keywords = [], size = 20) {
  // Text search using q parameter (plain text — correct usage per myscheme API)
  const q = keywords.length ? encodeURIComponent(keywords.join(' ')) : '';
  const url = `${MYSCHEME_BASE}/search/schemes/facets?lang=en&from=0&size=${size}${q ? '&q=' + q : ''}`;
  try {
    const data = await httpGet(url);
    const items = data?.data?.hits?.items || [];
    // If text search returned nothing, try a broader search without q
    if (items.length === 0 && q) {
      const fallbackUrl = `${MYSCHEME_BASE}/search/schemes/facets?lang=en&from=0&size=${size}`;
      const fbData = await httpGet(fallbackUrl);
      return fbData?.data?.hits?.items || [];
    }
    return items;
  } catch (e) {
    console.warn('[myscheme] Search error:', e.message);
    return [];
  }
}

// ─── Fetch full scheme detail from myscheme.gov.in ────────────────────────────
async function fetchSchemeDetail(slug) {
  try {
    const url = `${MYSCHEME_BASE}/schemes?slug=${slug}&lang=en`;
    const data = await httpGet(url);
    return data?.data || null;
  } catch {
    return null;
  }
}

// ─── Generate rich description using Groq ────────────────────────────────────
async function generateRichDescription(schemeData, userLang = 'hi') {
  const langInstruction = {
    hi: 'हिंदी में 3-4 वाक्य लिखो।',
    mr: 'मराठीत 3-4 वाक्य लिहा.',
    en: 'Write 3-4 sentences in English.',
  }[userLang] || 'हिंदी में 3-4 वाक्य लिखो।';

  const name    = schemeData?.schemeName || schemeData?.name || 'Unknown scheme';
  const brief   = schemeData?.briefDescription || '';
  const benefit = schemeData?.benefitDescription || schemeData?.benefits || '';
  const docs    = Array.isArray(schemeData?.documentsRequired)
    ? schemeData.documentsRequired.slice(0, 5).join(', ')
    : '';
  const howTo   = schemeData?.applicationProcess || schemeData?.howToApply || '';

  const prompt = `${langInstruction}
Scheme: ${name}
Brief: ${brief}
Benefits: ${benefit}
Documents required: ${docs}
How to apply: ${howTo}

Write a helpful 3-4 sentence description covering:
1. What benefit/money/help this scheme gives
2. Who is eligible (key criteria in simple words)
3. How to apply (one sentence)
4. Main document needed (if any)
Keep it simple for rural users.`;

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 200,
    });
    return completion.choices[0]?.message?.content?.trim() || brief;
  } catch {
    return brief;
  }
}

// ─── Source 2: pmindia.gov.in flagship schemes (static curated) ──────────────
// These are always-relevant major programmes; enriched by user-profile matching.
const PM_FLAGSHIP_SCHEMES = [
  { id: 'pmjay', name: 'Ayushman Bharat – PM-JAY', description: 'Health cover of ₹5 lakh per family per year for secondary and tertiary hospitalisation.', category: 'Health & Wellness', ministry: 'Ministry of Health & Family Welfare', application_url: 'https://pmjay.gov.in/', source: 'pmjay.gov.in', tags: ['health','bpl','poor','sc','st','obc'] },
  { id: 'pmkisan', name: 'PM-KISAN', description: 'Income support of ₹6,000/year to farmer families owning cultivable land.', category: 'Agriculture,Rural & Environment', ministry: 'Ministry of Agriculture & Farmers Welfare', application_url: 'https://pmkisan.gov.in/', source: 'pmkisan.gov.in', tags: ['farmer','agriculture','rural','kisan'] },
  { id: 'pmgky', name: 'PM Garib Kalyan Yojana', description: 'Free foodgrain distribution and other welfare measures for the poor.', category: 'Social welfare & Empowerment', ministry: 'Ministry of Consumer Affairs, Food & Public Distribution', application_url: 'https://dfpd.gov.in/', source: 'pmindia.gov.in', tags: ['bpl','poor','food','ration'] },
  { id: 'pmay-g', name: 'PM Awas Yojana – Gramin', description: 'Financial assistance for construction of pucca house to rural BPL families.', category: 'Housing & Shelter', ministry: 'Ministry of Rural Development', application_url: 'https://pmayg.nic.in/', source: 'pmayg.nic.in', tags: ['housing','rural','bpl','shelter'] },
  { id: 'pmay-u', name: 'PM Awas Yojana – Urban', description: 'Affordable housing for EWS/LIG urban families; subsidy on home loans.', category: 'Housing & Shelter', ministry: 'Ministry of Housing & Urban Affairs', application_url: 'https://pmaymis.gov.in/', source: 'pmaymis.gov.in', tags: ['housing','urban','ews','lig'] },
  { id: 'pmjjby', name: 'PM Jeevan Jyoti Bima Yojana', description: 'Term life insurance of ₹2 lakh at ₹436/year for bank-account holders aged 18–50.', category: 'Banking,Financial Services and Insurance', ministry: 'Ministry of Finance', application_url: 'https://jansuraksha.gov.in/', source: 'jansuraksha.gov.in', tags: ['insurance','life','bank','low income'] },
  { id: 'pmsby', name: 'PM Suraksha Bima Yojana', description: 'Accidental death/disability insurance of ₹2 lakh at just ₹20/year.', category: 'Banking,Financial Services and Insurance', ministry: 'Ministry of Finance', application_url: 'https://jansuraksha.gov.in/', source: 'jansuraksha.gov.in', tags: ['insurance','accident','bank','low income'] },
  { id: 'mudra', name: 'PM MUDRA Yojana', description: 'Collateral-free loans up to ₹10 lakh for non-farm micro/small enterprises.', category: 'Business & Entrepreneurship', ministry: 'Ministry of Finance', application_url: 'https://www.mudra.org.in/', source: 'mudra.org.in', tags: ['loan','business','entrepreneur','self-employed','small business'] },
  { id: 'pmegp', name: 'PM Employment Generation Programme', description: 'Subsidy-linked bank loans to set up micro-enterprises in rural & urban areas.', category: 'Business & Entrepreneurship', ministry: 'Ministry of MSME', application_url: 'https://www.kviconline.gov.in/', source: 'kviconline.gov.in', tags: ['entrepreneur','loan','employment','rural','urban'] },
  { id: 'nrega', name: 'MGNREGS', description: 'Guaranteed 100 days of unskilled wage employment per year for rural households.', category: 'Skills & Employment', ministry: 'Ministry of Rural Development', application_url: 'https://nrega.nic.in/', source: 'nrega.nic.in', tags: ['employment','rural','wage','labour','worker'] },
  { id: 'scholarship-sc', name: 'Post-Matric Scholarship for SC Students', description: 'Financial assistance for post-matric studies to SC students from low-income families.', category: 'Education & Learning', ministry: 'Ministry of Social Justice & Empowerment', application_url: 'https://scholarships.gov.in/', source: 'scholarships.gov.in', tags: ['sc','education','scholarship','student'] },
  { id: 'scholarship-obc', name: 'Post-Matric Scholarship for OBC Students', description: 'Scholarship for OBC students for higher education to reduce dropout rate.', category: 'Education & Learning', ministry: 'Ministry of Social Justice & Empowerment', application_url: 'https://scholarships.gov.in/', source: 'scholarships.gov.in', tags: ['obc','education','scholarship','student'] },
  { id: 'pm-vidyalaxmi', name: 'PM Vidyalaxmi', description: 'Collateral-free, guarantee-free education loans up to ₹10 lakh for meritorious students.', category: 'Education & Learning', ministry: 'Ministry of Education', application_url: 'https://www.vidyalakshmi.co.in/', source: 'vidyalakshmi.co.in', tags: ['education','loan','student','college'] },
  { id: 'naps', name: 'National Apprenticeship Promotion Scheme', description: 'Stipend support for apprentices; 25% of stipend reimbursed to employers to boost apprenticeships.', category: 'Skills & Employment', ministry: 'Ministry of Skill Development & Entrepreneurship', application_url: 'https://www.apprenticeshipindia.org/', source: 'apprenticeshipindia.org', tags: ['skill','apprentice','youth','employment'] },
  { id: 'pmfby', name: 'PM Fasal Bima Yojana', description: 'Crop insurance for farmers against natural calamities at very low premium.', category: 'Agriculture,Rural & Environment', ministry: 'Ministry of Agriculture & Farmers Welfare', application_url: 'https://pmfby.gov.in/', source: 'pmfby.gov.in', tags: ['farmer','crop','insurance','agriculture'] },
  { id: 'pmkvy', name: 'PM Kaushal Vikas Yojana', description: 'Free skill training and certification in industry-relevant trades for youth.', category: 'Skills & Employment', ministry: 'Ministry of Skill Development & Entrepreneurship', application_url: 'https://www.pmkvyofficial.org/', source: 'pmkvyofficial.org', tags: ['skill','youth','training','employment'] },
  { id: 'nsp', name: 'National Scholarship Portal', description: 'Single platform for pre-matric, post-matric and merit-based scholarships from central and state govts.', category: 'Education & Learning', ministry: 'Ministry of Electronics & IT', application_url: 'https://scholarships.gov.in/', source: 'scholarships.gov.in', tags: ['scholarship','student','education'] },
  { id: 'ujjwala', name: 'PM Ujjwala Yojana', description: 'Free LPG connection to BPL women; deposit-free cylinder for clean cooking fuel.', category: 'Utility & Sanitation', ministry: 'Ministry of Petroleum & Natural Gas', application_url: 'https://www.pmuy.gov.in/', source: 'pmuy.gov.in', tags: ['bpl','women','lpg','gas','poor'] },
  { id: 'swachh-bharat', name: 'Swachh Bharat Mission', description: 'Financial assistance of ₹12,000 for construction of household toilet in rural areas.', category: 'Utility & Sanitation', ministry: 'Ministry of Jal Shakti', application_url: 'https://swachhbharatmission.gov.in/', source: 'swachhbharatmission.gov.in', tags: ['toilet','rural','sanitation','bpl'] },
  { id: 'atal-pension', name: 'Atal Pension Yojana', description: 'Guaranteed pension of ₹1,000–₹5,000/month after 60; for unorganised sector workers.', category: 'Banking,Financial Services and Insurance', ministry: 'Ministry of Finance', application_url: 'https://npscra.nsdl.co.in/', source: 'npscra.nsdl.co.in', tags: ['pension','unorganised','worker','labour','old age'] },
  { id: 'stand-up-india', name: 'Stand-Up India', description: 'Bank loans of ₹10 lakh–₹1 crore for SC/ST and women entrepreneurs for greenfield enterprises.', category: 'Business & Entrepreneurship', ministry: 'Ministry of Finance', application_url: 'https://www.standupmitra.in/', source: 'standupmitra.in', tags: ['sc','st','women','business','entrepreneur','loan'] },
  { id: 'wcd-icds', name: 'Integrated Child Development Services (ICDS)', description: 'Nutrition, pre-school education, and health check-ups for children below 6 and pregnant/lactating mothers.', category: 'Women and Child', ministry: 'Ministry of Women & Child Development', application_url: 'https://wcd.nic.in/', source: 'wcd.nic.in', tags: ['child','nutrition','mother','pregnant','anganwadi'] },
  { id: 'pm-matru-vandana', name: 'PM Matru Vandana Yojana', description: 'Cash incentive of ₹5,000 in three instalments for first live birth to support pregnant and lactating mothers.', category: 'Women and Child', ministry: 'Ministry of Women & Child Development', application_url: 'https://wcd.nic.in/', source: 'wcd.nic.in', tags: ['pregnant','mother','women','baby','child'] },
  { id: 'nfbs', name: 'National Family Benefit Scheme', description: 'One-time lump sum of ₹20,000 to BPL families on death of primary bread-earner.', category: 'Social welfare & Empowerment', ministry: 'Ministry of Rural Development', application_url: 'https://nsap.nic.in/', source: 'nsap.nic.in', tags: ['bpl','death','family','poor'] },
  { id: 'nsap', name: 'National Social Assistance Programme', description: 'Monthly pension (₹200–₹500+) for old-age, widows and disabled BPL persons.', category: 'Social welfare & Empowerment', ministry: 'Ministry of Rural Development', application_url: 'https://nsap.nic.in/', source: 'nsap.nic.in', tags: ['pension','elderly','widow','disabled','bpl'] },
  { id: 'sparsh', name: 'SPARSH – PM Care for Children', description: 'Financial support and educational assistance for children who lost both parents to COVID-19.', category: 'Women and Child', ministry: 'Ministry of Women & Child Development', application_url: 'https://pmcaresforchildren.in/', source: 'pmcaresforchildren.in', tags: ['child','covid','orphan','education'] },
];

// ─── Source 4: data.gov.in open dataset search ───────────────────────────────
async function searchDataGovIn(keywords = []) {
  if (!process.env.DATA_GOV_API_KEY) return [];
  try {
    const kw = keywords.slice(0, 2).join(' ');
    const url = `https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070?api-key=${process.env.DATA_GOV_API_KEY}&format=json&limit=15&q=${encodeURIComponent(kw)}`;
    const data = await httpGet(url, { 'Accept': 'application/json' });
    const records = data?.records || [];
    return records
      .filter(r => r.scheme_name || r.title)
      .map(r => ({
        id:              'datagov_' + (r.serial_number || r.sno || Math.random()),
        name:            r.scheme_name || r.title || 'Unknown',
        description:     r.description || r.objective || r.brief_description || '',
        category:        r.sector || r.category || r.ministry_department || '',
        ministry:        r.ministry || r.ministry_department || r.department || '',
        benefit_value:   null,
        application_url: r.url || r.official_website || r.apply_url || 'https://data.gov.in/',
        source:          'data.gov.in',
      }));
  } catch (e) {
    console.warn('[data.gov.in] Error:', e.message);
    return [];
  }
}

// ─── Source 5: scholarships.gov.in (National Scholarship Portal) ─────────────
async function searchScholarshipsGovIn(profile) {
  // Only relevant for students / young people
  if (!profile || (profile.age > 35 && !profile.goals?.includes('education'))) return [];
  try {
    const url = 'https://scholarships.gov.in/api/v1/schemes?state=' + encodeURIComponent(profile.state || '') + '&limit=10';
    const data = await httpGet(url, { 'Accept': 'application/json' });
    const items = data?.data || data?.schemes || [];
    return items.map(s => ({
      id:              'nsp_' + (s.id || s.scheme_id || Math.random()),
      name:            s.name || s.scheme_name || 'Unknown',
      description:     s.description || s.brief || '',
      category:        'Education & Learning',
      ministry:        s.ministry || s.department || '',
      benefit_value:   null,
      application_url: s.url || `https://scholarships.gov.in/`,
      source:          'scholarships.gov.in',
    }));
  } catch (e) {
    // NSP API may not be public; silently ignore
    return [];
  }
}

// ─── Filter flagship schemes by profile relevance ────────────────────────────
function filterFlagshipByProfile(profile) {
  const kw = [
    profile.occupation,
    profile.caste,
    profile.bpl ? 'bpl' : '',
    profile.disabled ? 'disabled' : '',
    profile.gender === 'Female' ? 'women' : '',
    ...(profile.goals || []),
  ].filter(Boolean).map(k => k.toLowerCase());

  return PM_FLAGSHIP_SCHEMES.filter(s => {
    if (!kw.length) return true; // no filters → include all
    return s.tags.some(t => kw.some(k => t.includes(k) || k.includes(t)));
  });
}

// ─── Main: Get relevant schemes using Groq + multi-source live search ─────────
async function getRelevantSchemes(userId, limit = 10) {
  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = `schemes:${userId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[cache] HIT schemes for user ${userId} — returning instantly`);
    return cached;
  }
  console.log(`[cache] MISS schemes for user ${userId} — running full pipeline`);

  // 1. Get user profile
  const user = await fetchUserProfile(userId);
  const userLang = user.preferred_language || 'hi';

  const profile = {
    age:            user.age,
    gender:         user.gender,
    state:          user.state,
    occupation:     user.occupation,
    monthly_income: user.monthly_income,
    caste:          user.caste_category,
    bpl:            user.bpl_card,
    disabled:       user.is_disabled,
    goals:          user.goals,
  };

  console.log('[Groq+multi-source] User profile:', JSON.stringify(profile));

  // 2. Ask Groq for search keywords (text search — much better than facets)
  const keywordPrompt = `You are helping find Indian government welfare schemes for a user.

User Profile:
${JSON.stringify(profile, null, 2)}

Generate 4 short search keyword phrases (2-4 words each) that will find relevant schemes.
Example: "farmer income support", "bpl health insurance", "SC scholarship education"

Respond ONLY with JSON array: ["keyword 1", "keyword 2", "keyword 3", "keyword 4"]`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: keywordPrompt }],
    temperature: 0,
    max_tokens: 150,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '[]';
  console.log('[Groq] Keywords:', raw.slice(0, 200));

  let keywords = [];
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    keywords = match ? JSON.parse(match[0]) : [];
  } catch {
    keywords = [];
  }
  if (!keywords.length) keywords = [profile.occupation || 'welfare', profile.state || 'india'];

  // 3. Fetch from all sources in parallel
  const [mySchemeResults, dataGovResults, scholarshipResults] = await Promise.allSettled([
    // Run up to 3 keyword searches on myscheme
    Promise.all(keywords.slice(0, 3).map(kw =>
      searchMyScheme([kw], 12).catch(e => { console.warn('[myscheme]', e.message); return []; })
    )),
    searchDataGovIn(keywords),
    searchScholarshipsGovIn(profile),
  ]);

  // 4. Collect and deduplicate
  const seen = new Set();
  const rawItems = []; // raw myscheme items for detail fetching

  if (mySchemeResults.status === 'fulfilled') {
    for (const batch of mySchemeResults.value) {
      for (const item of batch) {
        const slug = item.fields?.slug;
        if (slug && !seen.has(slug)) { seen.add(slug); rawItems.push(item); }
      }
    }
  }
  console.log(`[multi-source] myscheme.gov.in → ${rawItems.length} unique`);

  // 5. Fetch full details for top 5 myscheme results and generate rich descriptions
  const topRaw = rawItems.slice(0, 5); // reduced from 8 to 5 for speed
  const enrichedMyScheme = await Promise.all(topRaw.map(async (item) => {
    const slug   = item.fields?.slug;
    const detail = await fetchSchemeDetail(slug).catch(() => null);
    const schemeData = detail || item.fields || {};
    const richDesc = await generateRichDescription(schemeData, userLang);

    const docsRequired = Array.isArray(schemeData.documentsRequired)
      ? schemeData.documentsRequired
      : (Array.isArray(schemeData.documents) ? schemeData.documents : []);

    return {
      id:              slug,
      name:            schemeData.schemeName || item.fields?.schemeName || 'Unknown',
      description:     richDesc,
      category:        (item.fields?.schemeCategory?.[0] || schemeData.schemeCategory?.[0] || ''),
      ministry:        schemeData.nodalMinistryName || item.fields?.nodalMinistryName || '',
      benefit_value:   null,
      application_url: `https://www.myscheme.gov.in/schemes/${slug}`,
      source:          'myscheme.gov.in',
      documents_required: docsRequired,
      how_to_apply:    schemeData.applicationProcess || schemeData.howToApply || '',
    };
  }));

  // 6. Add other sources
  const allSchemes = [...enrichedMyScheme];

  function addScheme(s) {
    const key = (s.name || '').toLowerCase().replace(/\s+/g, '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    allSchemes.push(s);
  }

  if (dataGovResults.status === 'fulfilled') {
    for (const s of dataGovResults.value) addScheme(s);
  }
  if (scholarshipResults.status === 'fulfilled') {
    for (const s of scholarshipResults.value) addScheme(s);
  }
  const flagship = filterFlagshipByProfile(profile);
  for (const s of flagship) addScheme(s);

  console.log(`[multi-source] Total after all sources → ${allSchemes.length}`);

  if (!allSchemes.length) return [];

  // 7. Ask Groq to rank
  const schemeList = allSchemes.map((s, i) =>
    `${i}: [${s.source}] ${s.name} | ${s.category}`
  );

  const rankPrompt = `User: age=${profile.age}, gender=${profile.gender}, state=${profile.state}, occupation=${profile.occupation}, income=₹${profile.monthly_income}/month, caste=${profile.caste}, bpl=${profile.bpl}, disabled=${profile.disabled}

Pick the ${limit} most relevant schemes (best first):
${schemeList.join('\n')}

Respond ONLY with JSON array of indices: [3, 0, 7, 2]`;

  const rankCompletion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: rankPrompt }],
    temperature: 0,
    max_tokens: 200,
  });

  const rankRaw = rankCompletion.choices[0]?.message?.content?.trim() || '[]';
  let indices;
  try {
    const match = rankRaw.match(/\[[\d,\s]+\]/);
    indices = match ? JSON.parse(match[0]) : [];
  } catch {
    indices = [];
  }
  if (!indices.length) indices = allSchemes.map((_, i) => i).slice(0, limit);

  const results = indices
    .filter(i => i >= 0 && i < allSchemes.length)
    .slice(0, limit)
    .map(i => allSchemes[i]);

  cacheSet(cacheKey, results);
  console.log(`[cache] SET schemes for user ${userId} (${results.length} results, TTL 1h)`);
  return results;
}
// ─── Insurance: use DB (only 6 policies, no need for live scraping) ───────────
async function getRelevantInsurance(userId, limit = 5) {
  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = `insurance:${userId}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    console.log(`[cache] HIT insurance for user ${userId} — returning instantly`);
    return cached;
  }
  console.log(`[cache] MISS insurance for user ${userId} — running full pipeline`);
  // Get user profile (via ProfileService cache; throws ProfileNotFoundError if missing)
  const user = await fetchUserProfile(userId);

  const policiesResult = await query(
    `SELECT id, source_id, name, description, category,
            annual_premium, coverage_amount, coverage_type,
            application_url, min_age, max_age, administered_by
     FROM insurance_policies WHERE is_active = TRUE`
  );
  const policies = policiesResult.rows;
  if (!policies.length) return [];

  const compact = policies.map(p => {
    // Handle both JSONB and string name columns
    const name = typeof p.name === 'object' && p.name !== null
      ? (p.name.en || p.name.hi || Object.values(p.name)[0] || 'Unknown')
      : (p.name || 'Unknown');
    return `${p.id}|${name}|age:${p.min_age}-${p.max_age}|premium:₹${p.annual_premium}|cover:₹${p.coverage_amount}`;
  }).join('\n');

  const prompt = `User: age=${user.age}, income=₹${user.monthly_income}/month, occupation=${user.occupation}, bpl=${user.bpl_card}

Pick suitable insurance (max ${limit}):
${compact}

Reply ONLY with JSON array of the id values (they may be UUIDs or numbers) like: ["uuid1","uuid2"]`;

  const completion = await groq.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 200,
  });

  const raw = completion.choices[0]?.message?.content?.trim() || '[]';
  let ids;
  try {
    const match = raw.match(/\[[\s\S]*?\]/);
    ids = match ? JSON.parse(match[0]) : [];
  } catch {
    ids = [];
  }

  if (!ids.length) {
    const fallback = policies.slice(0, limit);
    cacheSet(cacheKey, fallback);
    return fallback;
  }

  const results = policies.filter(p =>
    ids.some(id => String(id) === String(p.id) || String(id) === String(p.source_id))
  ).slice(0, limit);

  cacheSet(cacheKey, results);
  console.log(`[cache] SET insurance for user ${userId} (${results.length} results, TTL 1h)`);
  return results;
}

module.exports = { getRelevantSchemes, getRelevantInsurance, invalidateUserCache };
