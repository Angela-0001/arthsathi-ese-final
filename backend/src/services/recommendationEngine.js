'use strict';

/**
 * ArthSathi — Profile-Based Recommendation Engine v2
 *
 * Uses PostgreSQL TEXT[] columns target_groups and eligible_states
 * for accurate, fast, zero-token-limit scheme filtering.
 *
 * Run tag_schemes.js once to populate target_groups and eligible_states.
 * After that, recommendations are pure SQL — no AI at query time.
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
      `SELECT COUNT(*) FROM schemes WHERE is_active=TRUE AND target_groups IS NOT NULL AND target_groups != '{}'`
    );
    _taggingDone    = parseInt(r.rows[0].count) > 100; // at least 100 tagged
    _taggingChecked = true;
    return _taggingDone;
  } catch {
    return false;
  }
}

// ── SQL-based recommendation (after tagging) ────────────────────────────────
async function getSchemesByTags(profile, limit) {
  const age    = parseInt(profile.age)    || 25;
  const income = parseFloat(profile.monthly_income) || 0;
  const state  = profile.state || null;

  const isFemale    = profile.gender === 'female';
  const isDisabled  = profile.is_disabled === true || profile.has_disability === true;
  const isWidow     = profile.is_widow === true;
  const isElderly   = age >= 60;
  const isBPL       = profile.bpl_card === true || ['aay','phh'].includes(profile.ration_card_type || '');
  const isFarmer    = ['farmer','marginal_farmer','farm_laborer','farm_labourer'].includes(profile.occupation || '');
  const isStudent   = profile.is_student === true || profile.occupation === 'student';
  const hasGirl     = profile.has_girl_child === true;
  const caste       = (profile.caste_category || 'general').toLowerCase();

  // Build required groups based on profile
  const requiredGroups = [];
  if (isFemale || isWidow || hasGirl) requiredGroups.push('women');
  if (isWidow) requiredGroups.push('widow');
  if (isDisabled)  requiredGroups.push('disabled');
  if (isBPL || income < 5000) requiredGroups.push('bpl');
  if (isElderly)   requiredGroups.push('elderly');
  if (isFarmer)    requiredGroups.push('farmers');
  if (caste === 'sc') requiredGroups.push('sc');
  if (caste === 'st') requiredGroups.push('st');
  if (caste === 'obc') requiredGroups.push('obc');
  if (isStudent || hasGirl) requiredGroups.push('students');
  // Add goal-based groups
  const goal = profile.financial_goal || '';
  if (goal === 'housing') requiredGroups.push('housing');
  if (goal === 'health')  requiredGroups.push('health');
  if (goal === 'employment' || profile.occupation === 'unemployed') requiredGroups.push('employment');
  if (goal === 'business' || profile.occupation === 'self_employed') requiredGroups.push('business');

  const results = [];
  const usedIds = new Set();

  // ── STEP 1: Get schemes for each required group (1-2 per group) ──────────
  for (const group of requiredGroups) {
    if (results.length >= limit) break;

    // Exclude non-matching castes for general users
    const casteExclusion = caste === 'general'
      ? `AND NOT ('sc' = ANY(target_groups)) AND NOT ('st' = ANY(target_groups)) AND NOT ('obc' = ANY(target_groups))`
      : '';

    const stateFilter = state
      ? `AND (eligible_states = '{}' OR $4 = ANY(eligible_states))`
      : `AND eligible_states = '{}'`;

    const excludeClause = usedIds.size > 0
      ? `AND id NOT IN (${[...usedIds].map((_, i) => `$${i + (state ? 5 : 4)}`).join(',')})`
      : '';

    const params = [age, income, group];
    if (state) params.push(state);
    params.push(...usedIds);

    const r = await query(
      `SELECT id, scheme_id, name, description, category, ministry,
              min_age, max_age, max_income, benefit_value, application_url, target_groups
       FROM schemes WHERE is_active = TRUE
         AND $3 = ANY(target_groups)
         AND (min_age IS NULL OR min_age <= $1)
         AND (max_age IS NULL OR max_age >= $1)
         AND (max_income IS NULL OR max_income >= $2)
         ${stateFilter}
         ${casteExclusion}
         ${excludeClause}
       ORDER BY
         CASE WHEN eligible_states != '{}' THEN 0 ELSE 1 END, -- prefer state-specific
         engagement_weight DESC NULLS LAST
       LIMIT 2`,
      params
    );

    for (const s of r.rows) {
      if (!usedIds.has(s.id)) {
        usedIds.add(s.id);
        results.push(s);
      }
    }
  }

  // ── STEP 2: Fill remaining slots with general eligible schemes ────────────
  const remaining = limit - results.length;
  if (remaining > 0) {
    const casteExclusion = caste === 'general'
      ? `AND NOT ('sc' = ANY(target_groups)) AND NOT ('st' = ANY(target_groups)) AND NOT ('obc' = ANY(target_groups))`
      : '';

    const stateFilter = state
      ? `AND (eligible_states = '{}' OR $3 = ANY(eligible_states))`
      : '';

    const excludeClause = usedIds.size > 0
      ? `AND id NOT IN (${[...usedIds].map((_, i) => `$${i + (state ? 4 : 3)}`).join(',')})`
      : '';

    const params = [age, income];
    if (state) params.push(state);
    params.push(...usedIds);

    const r = await query(
      `SELECT id, scheme_id, name, description, category, ministry,
              min_age, max_age, max_income, benefit_value, application_url, target_groups
       FROM schemes WHERE is_active = TRUE
         AND (min_age IS NULL OR min_age <= $1)
         AND (max_age IS NULL OR max_age >= $1)
         AND (max_income IS NULL OR max_income >= $2)
         ${stateFilter}
         ${casteExclusion}
         ${excludeClause}
       ORDER BY engagement_weight DESC NULLS LAST
       LIMIT ${remaining}`,
      params
    );

    for (const s of r.rows) {
      if (!usedIds.has(s.id)) {
        usedIds.add(s.id);
        results.push(s);
      }
    }
  }

  return results;
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
    console.log('[RecommendEngine] Using SQL tag-based filtering');
    return getSchemesByTags(profile, limit);
  }

  // Fallback: keyword-based (until tagging is done)
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

  // Fill remaining
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
