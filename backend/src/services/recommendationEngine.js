'use strict';

/**
 * ArthSathi — Profile-Based Recommendation Engine v2
 *
 * Uses PostgreSQL TEXT[] columns target_groups and eligible_states
 * for accurate, fast, zero-token-limit scheme filtering.
 *
 * Run tag_schemes.js once to populate target_groups and eligible_states.
 */

const { query } = require('../db');
const Groq = require('groq-sdk');

const groq  = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// ── Check if schemes have been tagged ──────────────────────────────────────
let _taggingChecked = false;
let _taggingDone    = false;

async function isTaggingDone() {
  if (_taggingChecked) return _taggingDone;
  try {
    const r = await query(
      "SELECT COUNT(*) FROM schemes WHERE is_active=TRUE AND target_groups IS NOT NULL AND target_groups != '{}'"
    );
    _taggingDone    = parseInt(r.rows[0].count) > 100;
    _taggingChecked = true;
    return _taggingDone;
  } catch {
    return false;
  }
}

// ── SQL-based recommendation using target_groups + eligible_states ──────────
async function getSchemesByTags(profile, limit) {
  const age    = parseInt(profile.age)    || 25;
  const income = parseFloat(profile.monthly_income) || 0;
  const state  = profile.state || null;
  const caste  = (profile.caste_category || 'general').toLowerCase();

  const isFemale   = profile.gender === 'female';
  const isDisabled = profile.is_disabled === true || profile.has_disability === true;
  const isWidow    = profile.is_widow === true;
  const isElderly  = age >= 50;  // pension schemes from age 50+
  const isBPL      = profile.bpl_card === true || ['aay','phh'].includes(profile.ration_card_type || '');
  const isFarmer   = ['farmer','marginal_farmer','farm_laborer','farm_labourer'].includes(profile.occupation || '');
  const isStudent  = profile.is_student === true || profile.occupation === 'student';
  const hasGirl    = profile.has_girl_child === true;
  const goal       = profile.financial_goal || '';
  const isNonGeneral = ['sc','st','obc','nt','vjnt'].includes(caste);

  // Build priority group list — ORDER MATTERS (highest priority first)
  const priorityGroups = [];

  // 1. Disabled — highest priority
  if (isDisabled)              priorityGroups.push('disabled');

  // 2. Backward caste (SC/ST/OBC)
  if (caste === 'sc')          priorityGroups.push('sc');
  if (caste === 'st')          priorityGroups.push('st');
  if (caste === 'obc')         priorityGroups.push('obc');

  // 3. Women / widow
  if (isFemale || hasGirl)     priorityGroups.push('women');
  if (isWidow)                 priorityGroups.push('widow');

  // 4. Elderly / pension (50+)
  if (isElderly)               priorityGroups.push('elderly');

  // 5. Girl child / daughter
  if (hasGirl)                 priorityGroups.push('students'); // beti bachao, sukanya etc

  // 6. BPL / poor
  if (isBPL || income < 5000)  priorityGroups.push('bpl');

  // 7. Farmer
  if (isFarmer)                priorityGroups.push('farmers');

  // 8. Student
  if (isStudent)               priorityGroups.push('students');

  // 9. Goal-based
  if (goal === 'housing')      priorityGroups.push('housing');
  if (goal === 'health')       priorityGroups.push('health');
  if (goal === 'employment' || profile.occupation === 'unemployed') priorityGroups.push('employment');
  if (goal === 'business' || profile.occupation === 'self_employed') priorityGroups.push('business');

  // Deduplicate while preserving order
  const seen = new Set();
  const orderedGroups = priorityGroups.filter(g => seen.has(g) ? false : (seen.add(g), true));

  const usedIds    = new Set();
  const usedNames  = new Set(); // dedup by name too
  const results    = [];

  // Helper: fetch schemes for one group, state-aware
  async function fetchForGroup(group, maxResults = 2) {
    if (results.length >= limit) return;

    // For elderly group, only show if user is actually 50+
    // For other groups tagged with elderly, still show if they match another group
    const elderlyFilter = group === 'elderly'
      ? '' // already controlled by isElderly check before calling
      : `AND NOT (target_groups = ARRAY['elderly'] AND $1 < 50)`; // don't show elderly-only schemes to young users

    // Caste exclusion for general users
    const casteExcl = caste === 'general'
      ? `AND NOT ('sc' = ANY(target_groups)) AND NOT ('st' = ANY(target_groups)) AND NOT ('obc' = ANY(target_groups))`
      : '';

    // Age-appropriate filter — don't show "old age home" etc to young users
    const ageAppropriate = age < 50
      ? `AND NOT (name::text ILIKE '%old age home%' OR name::text ILIKE '%vriddhashram%' OR name::text ILIKE '%senior citizen home%')`
      : '';

    // State filter: prefer state-specific, also include national (empty states)
    const excludeArr = [...usedIds];
    const excludeClause = excludeArr.length > 0
      ? `AND id NOT IN (${excludeArr.map((_, i) => `$${i + (state ? 5 : 4)}`).join(',')})`
      : '';

    let params, sql;
    if (state) {
      params = [age, income, group, state, ...excludeArr];
      sql = `
        SELECT id, scheme_id, name, description, category, ministry,
               min_age, max_age, max_income, benefit_value, application_url,
               target_groups, eligible_states
        FROM schemes WHERE is_active = TRUE
          AND $3 = ANY(target_groups)
          AND (min_age IS NULL OR min_age <= $1)
          AND (max_age IS NULL OR max_age >= $1)
          AND (max_income IS NULL OR max_income >= $2)
          AND (eligible_states = '{}' OR $4 = ANY(eligible_states))
          ${casteExcl}
          ${ageAppropriate}
          ${excludeClause}
        ORDER BY
          CASE WHEN $4 = ANY(eligible_states) THEN 0 ELSE 1 END,
          engagement_weight DESC NULLS LAST
        LIMIT ${maxResults}`;
    } else {
      params = [age, income, group, ...excludeArr];
      sql = `
        SELECT id, scheme_id, name, description, category, ministry,
               min_age, max_age, max_income, benefit_value, application_url,
               target_groups, eligible_states
        FROM schemes WHERE is_active = TRUE
          AND $3 = ANY(target_groups)
          AND (min_age IS NULL OR min_age <= $1)
          AND (max_age IS NULL OR max_age >= $1)
          AND (max_income IS NULL OR max_income >= $2)
          ${casteExcl}
          ${ageAppropriate}
          ${excludeClause}
        ORDER BY engagement_weight DESC NULLS LAST
        LIMIT ${maxResults}`;
    }

    const r = await query(sql, params);
    for (const s of r.rows) {
      const nameKey = (typeof s.name === 'object' ? (s.name.en || s.name.hi || '') : (s.name || '')).toLowerCase().trim();
      if (!usedIds.has(String(s.id)) && !usedNames.has(nameKey)) {
        usedIds.add(String(s.id));
        usedNames.add(nameKey);
        results.push(s);
      }
    }
  }

  // ── STEP 1: Fetch 1-2 schemes per priority group ─────────────────────────
  for (const group of orderedGroups) {
    if (results.length >= limit) break;
    await fetchForGroup(group, 2);
  }

  console.log(`[RecommendEngine] Priority slots filled: ${results.length}`);

  // ── STEP 2: Fill remaining with general eligible schemes ──────────────────
  const remaining = limit - results.length;
  if (remaining > 0) {
    const casteExcl = caste === 'general'
      ? `AND NOT ('sc' = ANY(target_groups)) AND NOT ('st' = ANY(target_groups)) AND NOT ('obc' = ANY(target_groups))`
      : '';

    const excludeArr = [...usedIds];
    const excludeClause = excludeArr.length > 0
      ? `AND id NOT IN (${excludeArr.map((_, i) => `$${i + (state ? 4 : 3)}`).join(',')})`
      : '';

    let params, sql;
    if (state) {
      params = [age, income, state, ...excludeArr];
      sql = `
        SELECT id, scheme_id, name, description, category, ministry,
               min_age, max_age, max_income, benefit_value, application_url,
               target_groups, eligible_states
        FROM schemes WHERE is_active = TRUE
          AND (min_age IS NULL OR min_age <= $1)
          AND (max_age IS NULL OR max_age >= $1)
          AND (max_income IS NULL OR max_income >= $2)
          AND (eligible_states = '{}' OR $3 = ANY(eligible_states))
          ${casteExcl}
          ${excludeClause}
        ORDER BY
          CASE WHEN $3 = ANY(eligible_states) THEN 0 ELSE 1 END,
          engagement_weight DESC NULLS LAST
        LIMIT ${remaining}`;
    } else {
      params = [age, income, ...excludeArr];
      sql = `
        SELECT id, scheme_id, name, description, category, ministry,
               min_age, max_age, max_income, benefit_value, application_url,
               target_groups, eligible_states
        FROM schemes WHERE is_active = TRUE
          AND (min_age IS NULL OR min_age <= $1)
          AND (max_age IS NULL OR max_age >= $1)
          AND (max_income IS NULL OR max_income >= $2)
          ${casteExcl}
          ${excludeClause}
        ORDER BY engagement_weight DESC NULLS LAST
        LIMIT ${remaining}`;
    }

    const r = await query(sql, params);
    for (const s of r.rows) {
      const nameKey = (typeof s.name === 'object' ? (s.name.en || s.name.hi || '') : (s.name || '')).toLowerCase().trim();
      if (!usedIds.has(String(s.id)) && !usedNames.has(nameKey)) {
        usedIds.add(String(s.id));
        usedNames.add(nameKey);
        results.push(s);
      }
    }
  }

  // ── STEP 3: Use Groq to re-rank if available ─────────────────────────────
  if (groq && results.length > 5) {
    try {
      const list = results.map((s, i) => {
        const name = typeof s.name === 'object' ? (s.name.en || s.name.hi || '') : (s.name || '');
        return `${i}|${name}|${(s.target_groups||[]).join(',')}`;
      }).join('\n');

      const profileStr = `age:${age},gender:${profile.gender},caste:${caste},occupation:${profile.occupation},income:${income},state:${state||'any'},bpl:${isBPL},disabled:${isDisabled},widow:${isWidow},goal:${goal}`;

      const r = await groq.chat.completions.create({
        model: MODEL,
        messages: [{ role: 'user', content: `Re-rank these ${results.length} Indian govt schemes from most to least relevant for this user: ${profileStr}\n\nSchemes:\n${list}\n\nReply ONLY with JSON array of indices in order of relevance: [3,0,7,...]` }],
        temperature: 0,
        max_tokens: 100,
      });

      const raw   = r.choices[0]?.message?.content?.trim() || '';
      const match = raw.match(/\[[\d,\s]+\]/);
      if (match) {
        const indices = JSON.parse(match[0]).filter(i => i >= 0 && i < results.length);
        // Apply re-ranking
        const reranked = indices.map(i => results[i]);
        // Add any not in reranked list at the end
        const inReranked = new Set(indices);
        for (let i = 0; i < results.length; i++) {
          if (!inReranked.has(i)) reranked.push(results[i]);
        }
        console.log('[RecommendEngine] Groq re-ranked results');
        return reranked.slice(0, limit);
      }
    } catch (e) {
      console.log('[RecommendEngine] Groq re-rank skipped:', e.message);
    }
  }

  console.log(`[RecommendEngine] Final: ${results.length} schemes`);
  return results.slice(0, limit);
}

// ── Keyword fallback (before tagging is done) ───────────────────────────────
async function fetchByKeywords(keywords, age, income, excludeIds = [], limit = 2) {
  if (!keywords.length) return [];
  const kw = keywords.map(k => `%${k}%`);
  const excl = excludeIds.length > 0
    ? `AND id NOT IN (${excludeIds.map((_, i) => `$${i + kw.length + 3}`).join(',')})`
    : '';
  const nameConditions = kw.map((_, i) => `name::text ILIKE $${i+3}`).join(' OR ');
  const descConditions = kw.map((_, i) => `description::text ILIKE $${i+3}`).join(' OR ');

  const r = await query(
    `SELECT id, scheme_id, name, description, category, ministry,
            min_age, max_age, max_income, benefit_value, application_url
     FROM schemes WHERE is_active = TRUE
       AND (${nameConditions} OR ${descConditions})
       AND (min_age IS NULL OR min_age <= $1)
       AND (max_age IS NULL OR max_age >= $1)
       AND (max_income IS NULL OR max_income >= $2)
       ${excl}
     ORDER BY
       CASE WHEN (${nameConditions}) THEN 0 ELSE 1 END,
       engagement_weight DESC NULLS LAST
     LIMIT ${limit}`,
    [age, income, ...kw, ...excludeIds]
  );
  return r.rows;
}

// ── Main recommendation function ────────────────────────────────────────────
async function getProfileSchemes(profile, limit = 10) {
  const tagged = await isTaggingDone();

  if (tagged) {
    console.log('[RecommendEngine] Using SQL tag-based filtering + Groq re-ranking');
    return getSchemesByTags(profile, limit);
  }

  // Fallback keyword-based
  console.log('[RecommendEngine] Using keyword fallback (run tag_schemes.js to enable SQL filtering)');
  const age    = parseInt(profile.age)    || 25;
  const income = parseFloat(profile.monthly_income) || 0;
  const isFemale    = profile.gender === 'female';
  const isDisabled  = profile.is_disabled === true || profile.has_disability === true;
  const isWidow     = profile.is_widow === true;
  const isElderly   = age >= 60;
  const isBPL       = profile.bpl_card === true || ['aay','phh'].includes(profile.ration_card_type || '');
  const isFarmer    = ['farmer','marginal_farmer','farm_laborer'].includes(profile.occupation || '');
  const isStudent   = profile.is_student === true;
  const hasGirl     = profile.has_girl_child === true;
  const caste       = (profile.caste_category || 'general').toLowerCase();
  const isNonGeneral = ['sc','st','obc','nt','vjnt'].includes(caste);

  const selectedIds = [];
  const results = [];

  function addSchemes(schemes) {
    for (const s of schemes) {
      if (!selectedIds.includes(String(s.id))) {
        selectedIds.push(String(s.id));
        results.push(s);
      }
    }
  }

  if (isFemale || isWidow || hasGirl) addSchemes(await fetchByKeywords(['mahila','women','beti','kanya','stri','widow','vidhwa','matru'], age, income, selectedIds, 2));
  if (isDisabled && results.length < limit) addSchemes(await fetchByKeywords(['divyang','disability','disabled','handicap','viklang'], age, income, selectedIds, 1));
  if (isElderly && results.length < limit) addSchemes(await fetchByKeywords(['pension','old age','vridh','senior citizen'], age, income, selectedIds, 1));
  if ((isBPL || income < 5000) && results.length < limit) addSchemes(await fetchByKeywords(['garib','poor','BPL','antyodaya','below poverty'], age, income, selectedIds, 1));
  if (isNonGeneral && results.length < limit) {
    const casteKw = { sc: ['scheduled caste','SC dalit'], st: ['scheduled tribe','ST tribal'], obc: ['OBC backward'] };
    addSchemes(await fetchByKeywords(casteKw[caste] || ['backward'], age, income, selectedIds, 1));
  }
  if (isFarmer && results.length < limit) addSchemes(await fetchByKeywords(['kisan','farmer','PM-KISAN','fasal','agriculture'], age, income, selectedIds, 1));
  if ((isStudent || hasGirl) && results.length < limit) addSchemes(await fetchByKeywords(['scholarship','beti bachao','sukanya','education'], age, income, selectedIds, 1));

  const remaining = Math.max(0, limit - results.length);
  if (remaining > 0) {
    try {
      const idPlaceholders = selectedIds.length > 0
        ? `AND id NOT IN (${selectedIds.map((_, i) => `$${i+3}`).join(',')})`
        : '';
      const eligible = await query(
        `SELECT id, scheme_id, name, description, category, ministry,
                min_age, max_age, max_income, benefit_value, application_url
         FROM schemes WHERE is_active = TRUE
           AND (min_age IS NULL OR min_age <= $1)
           AND (max_age IS NULL OR max_age >= $1)
           AND (max_income IS NULL OR max_income >= $2)
           ${idPlaceholders}
         ORDER BY engagement_weight DESC NULLS LAST LIMIT 30`,
        [age, income, ...selectedIds]
      );
      addSchemes(eligible.rows.slice(0, remaining));
    } catch (e) {
      console.error('[RecommendEngine] Fill error:', e.message);
    }
  }

  console.log(`[RecommendEngine] Final: ${results.length} schemes`);
  return results.slice(0, limit);
}

// ── Insurance recommendation ─────────────────────────────────────────────────
async function getProfileInsurance(profile, limit = 5) {
  const age    = parseInt(profile.age) || 25;
  const income = parseFloat(profile.monthly_income) || 0;
  const isFarmer = ['farmer','marginal_farmer','farm_laborer'].includes(profile.occupation || '');
  const hasBank  = profile.has_bank_account !== false;

  const r = await query(
    `SELECT id, source_id, name, description, category, annual_premium,
            coverage_amount, coverage_type, application_url, min_age, max_age
     FROM insurance_policies WHERE is_active = TRUE
       AND (min_age IS NULL OR min_age <= $1)
       AND (max_age IS NULL OR max_age >= $1)
     ORDER BY annual_premium ASC NULLS FIRST`,
    [age]
  );
  const all = r.rows;
  if (!all.length) return [];

  if (groq) {
    try {
      const list = all.map((p, i) => {
        const name = typeof p.name === 'object' ? (p.name.en || p.name.hi || '') : (p.name || '');
        return `${i}|${name}|Rs.${p.annual_premium}/yr|${p.coverage_type}`;
      }).join('\n');

      const res = await groq.chat.completions.create({
        model: MODEL,
        messages: [{
          role: 'user',
          content: `Pick ${limit} best insurance for: age ${age}, income Rs.${income}, ${isFarmer?'farmer':'non-farmer'}, bank: ${hasBank?'yes':'no'}. Reply ONLY JSON: [0,1,2]\n${list}`,
        }],
        temperature: 0,
        max_tokens: 40,
      });

      const raw   = res.choices[0]?.message?.content?.trim() || '[]';
      const match = raw.match(/\[[\d,\s]+\]/);
      const idxs  = match ? JSON.parse(match[0]) : [];
      const picked = idxs.filter(i => i >= 0 && i < all.length).slice(0, limit).map(i => all[i]);
      if (picked.length) return picked;
    } catch (e) {
      console.error('[RecommendEngine] Insurance Groq error:', e.message);
    }
  }

  return all.slice(0, limit);
}

module.exports = { getProfileSchemes, getProfileInsurance };
