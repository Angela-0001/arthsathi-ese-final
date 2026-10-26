'use strict';

/**
 * ArthSathi — Profile-Based Recommendation Engine
 *
 * Implements mandatory slot logic:
 * - Female   → women-centric schemes
 * - Widow    → widow pension
 * - Disabled → disability schemes
 * - Elderly  → old age pension
 * - BPL/Poor → poverty relief
 * - SC/ST/OBC → caste-specific
 * - Farmer   → agricultural
 * - Student  → education/scholarship
 * Remaining slots filled by Groq or DB fallback.
 */

const { query } = require('../db');
const Groq = require('groq-sdk');

const groq  = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// ── Keyword search helper ───────────────────────────────────────────────────
async function fetchByKeywords(keywords, age, income, excludeIds = [], limit = 2) {
  if (!keywords.length) return [];
  // Search name only (not description) for mandatory slots to avoid false positives
  const kw = keywords.map(k => `%${k}%`);
  const excl = excludeIds.length > 0
    ? `AND id NOT IN (${excludeIds.map((_, i) => `$${i + kw.length + 3}`).join(',')})`
    : '';
  const nameConditions  = kw.map((_, i) => `name::text ILIKE $${i+3}`).join(' OR ');
  const descConditions  = kw.map((_, i) => `description::text ILIKE $${i+3}`).join(' OR ');

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
  const age    = parseInt(profile.age)    || 25;
  const income = parseFloat(profile.monthly_income) || 0;

  const isFemale    = profile.gender === 'female';
  const isDisabled  = profile.is_disabled === true || profile.has_disability === true;
  const isWidow     = profile.is_widow === true;
  const isElderly   = age >= 60;
  const isBPL       = profile.bpl_card === true || ['aay','phh'].includes(profile.ration_card_type || '');
  const isFarmer    = ['farmer','marginal_farmer','farm_laborer','farm_labourer'].includes(profile.occupation || '');
  const isStudent   = profile.is_student === true || profile.occupation === 'student';
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

  // ── MANDATORY SLOTS ─────────────────────────────────────────────────────

  // 1. Women-centric (for females)
  if (isFemale) {
    const r = await fetchByKeywords(['mahila','women','beti','kanya','stri','female','girl','widow','vidhwa','matru'], age, income, selectedIds, 2);
    addSchemes(r);
  }

  // 2. Widow pension (for widows)
  if (isWidow && results.length < limit) {
    const r = await fetchByKeywords(['vidhwa','widow','pension','indira gandhi'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  // 3. Disability schemes (for disabled)
  if (isDisabled && results.length < limit) {
    const r = await fetchByKeywords(['divyang','disability','disabled','handicap','viklang','specially abled'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  // 4. Old age pension (for elderly 60+)
  if (isElderly && results.length < limit) {
    const r = await fetchByKeywords(['pension','old age','vridh','senior citizen','bujurg','indira gandhi national old'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  // 5. BPL/poverty relief
  if ((isBPL || income < 5000) && results.length < limit) {
    const r = await fetchByKeywords(['garib','poor','BPL','antyodaya','PM Garib','ration','food security','below poverty'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  // 6. Caste-specific (ONLY for non-general caste)
  if (isNonGeneral && results.length < limit) {
    const casteKw = {
      sc:  ['scheduled caste','SC','dalit','post matric sc'],
      st:  ['scheduled tribe','ST','tribal','adivasi'],
      obc: ['OBC','other backward','backward class'],
      nt:  ['nomadic','denotified'],
      vjnt:['vjnt','vimukta'],
    };
    const r = await fetchByKeywords(casteKw[caste] || ['backward','SC','ST'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  // 7. Farmer schemes
  if (isFarmer && results.length < limit) {
    const r = await fetchByKeywords(['kisan','farmer','PM-KISAN','fasal','crop insurance','agriculture','krishi'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  // 8. Education/girl child
  if ((isStudent || hasGirl) && results.length < limit) {
    const r = await fetchByKeywords(['scholarship','beti bachao','sukanya','education loan','chhatra','student','vidya'], age, income, selectedIds, 1);
    addSchemes(r);
  }

  console.log(`[RecommendEngine] Mandatory: ${results.length} slots filled, need ${Math.max(0, limit - results.length)} more`);

  // ── FILL REMAINING WITH GROQ OR DB ──────────────────────────────────────
  const remaining = Math.max(0, limit - results.length);

  if (remaining > 0) {
    const idPlaceholders = selectedIds.length > 0
      ? `AND id NOT IN (${selectedIds.map((_, i) => `$${i+3}`).join(',')})`
      : '';

    try {
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
      console.log(`[RecommendEngine] Eligible pool: ${eligible.rows.length}`);

      const pool = eligible.rows;

      // Skip Groq for fill step — just take top eligible schemes by engagement weight
      // Groq is already used for mandatory slots selection via keywords
      addSchemes(pool.slice(0, remaining));
    } catch (e) {
      console.error('[RecommendEngine] DB fill error:', e.message);
    }
  }

  console.log(`[RecommendEngine] Final: ${results.length} schemes for user ${profile.id || '?'}`);
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
