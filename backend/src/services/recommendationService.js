/**
 * ArthSathi — Recommendation Engine (Node.js side)
 *
 * This module implements the FULL eligibility filter and weighted scoring
 * algorithm directly in JavaScript for synchronous in-process use by the
 * Express routes. The Python ml-model/engine.py implements the same logic
 * with additional ML-based weight adaptation.
 *
 * ALGORITHM OVERVIEW
 * ==================
 * Step 1 — Hard eligibility filter
 *   Reject any scheme/policy where the user definitively fails a criterion.
 *   Fields checked: age, annual_income, gender, caste_category, occupation,
 *   eligible_states, requires_bank_account, requires_jan_dhan.
 *
 * Step 2 — Weighted score (0.0–1.0)
 *   Five components, each normalised to [0,1]:
 *
 *   (a) goalRelevanceScore  — how closely the scheme's tags/category match
 *       the user's stated financial_goal keywords. Weight: 0.30
 *
 *   (b) urgencyMatchScore   — inversely proportional to scheme application
 *       complexity when user urgency is high. Proxy: benefit_amount vs
 *       goal_amount. Weight: 0.20
 *
 *   (c) benefitSignificanceScore — benefit_amount / annual_income, capped at 1.
 *       Higher benefit relative to income = more significant. Weight: 0.25
 *
 *   (d) eligibilityComfortScore — how comfortably the user sits inside the
 *       eligibility window (e.g., age 25 for a 18–60 window scores higher
 *       than age 59). Weight: 0.15
 *
 *   (e) accessibilityScore — schemes with lower barriers (no collateral, no
 *       land requirement, government-backed) score higher for rural users.
 *       Weight: 0.10
 *
 *   Final score = Σ (weight_i × component_i)
 *
 * Step 3 — Sort descending by score, return ranked list with explanations.
 *
 * ADAPTIVE WEIGHTS
 * ================
 * The weights above are the defaults. The Python ml-model/engine.py runs a
 * scheduled retraining job that analyses interaction_events (view, click,
 * apply, dismiss) and adjusts weights to maximise click/apply rate.
 * Adjusted weights are written to ml-model/weights.json and loaded here
 * at startup with a file-watch refresh.
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Weight loading — defaults, overridable by ml-model/weights.json
// ---------------------------------------------------------------------------
const WEIGHTS_PATH = path.join(__dirname, '../../../ml-model/weights.json');

const DEFAULT_WEIGHTS = {
  goalRelevance:         0.30,
  urgencyMatch:          0.20,
  benefitSignificance:   0.25,
  eligibilityComfort:    0.15,
  accessibility:         0.10,
};

let currentWeights = { ...DEFAULT_WEIGHTS };

/**
 * Load weights from the ML engine's output file, if it exists.
 * Falls back to defaults silently.
 */
function loadWeights() {
  try {
    if (fs.existsSync(WEIGHTS_PATH)) {
      const raw = fs.readFileSync(WEIGHTS_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      // Validate that all keys are present and values are numbers
      const allValid = Object.keys(DEFAULT_WEIGHTS).every(
        k => typeof parsed[k] === 'number' && parsed[k] >= 0
      );
      if (allValid) {
        currentWeights = parsed;
        console.log('[Recommendation] Loaded adaptive weights from ml-model/weights.json');
      }
    }
  } catch (e) {
    console.warn('[Recommendation] Could not load weights.json, using defaults:', e.message);
  }
}

// Initial load
loadWeights();

// Refresh weights every 10 minutes (adaptive engine runs daily, but we reload frequently)
setInterval(loadWeights, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Checks whether an array criterion is satisfied.
 * If the criterion array is null/empty, it means "no restriction" — pass.
 * If non-empty, the user value must be included.
 */
function arrayIncludes(criterionArray, userValue) {
  if (!criterionArray || criterionArray.length === 0) return true;
  if (userValue == null) return false;
  return criterionArray.includes(userValue);
}

/**
 * Returns a score [0,1] for how well a free-text goal string matches
 * an array of scheme tags and a category string.
 *
 * Approach: simple keyword overlap ratio. Not ML-based — this is the
 * original, hand-written logic. The Python engine can enhance it with
 * TF-IDF or sentence embeddings when available.
 */
function goalRelevanceScore(goal, tags, category) {
  if (!goal || (!tags && !category)) return 0.3; // neutral when no data

  const goalWords = goal.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (goalWords.length === 0) return 0.3;

  const schemeTokens = [
    ...(tags || []),
    category,
  ].join(' ').toLowerCase().split(/[\s_]+/);

  const matches = goalWords.filter(w => schemeTokens.some(t => t.includes(w) || w.includes(t)));
  const overlapRatio = matches.length / goalWords.length;

  // Boost for direct category keywords
  const categoryBoosts = {
    agriculture: ['farm','kisan','crop','seed','kharif','rabi','irrigation','soil'],
    health:      ['health','medical','hospital','surgery','ill','disease','medicine'],
    housing:     ['house','home','pucca','shelter','construction','roof'],
    education:   ['school','college','study','scholarship','education','tuition'],
    employment:  ['job','work','employment','wage','daily','labour','labor'],
    insurance:   ['insurance','accident','death','life','cover','premium'],
  };

  const boostWords = categoryBoosts[category] || [];
  const directHit = goalWords.some(w => boostWords.includes(w)) ? 0.2 : 0;

  return Math.min(1.0, overlapRatio + directHit);
}

/**
 * Urgency match score: high urgency users benefit more from high-benefit,
 * low-application-complexity schemes.
 *
 * urgency_level: 1 (low) → 5 (critical)
 * Proxy for complexity: if annual_premium is very low or scheme is free,
 * it's faster to access. Benefit/goal_amount ratio also matters.
 */
function urgencyMatchScore(urgencyLevel, benefitAmount, goalAmount, isPremiumFree) {
  if (!urgencyLevel) return 0.5;

  const urgencyFactor = urgencyLevel / 5; // 0.2–1.0

  // If the scheme covers a large fraction of the goal, it's urgent-relevant
  let coverageFactor = 0.5;
  if (benefitAmount && goalAmount && goalAmount > 0) {
    coverageFactor = Math.min(1.0, benefitAmount / goalAmount);
  }

  // Free/low-cost schemes are more accessible quickly
  const accessFactor = isPremiumFree ? 1.0 : 0.7;

  return (urgencyFactor * 0.5) + (coverageFactor * 0.3) + (accessFactor * 0.2);
}

/**
 * Benefit significance: how meaningful is the benefit relative to income?
 * A Rs.6,000/year scheme is highly significant for someone earning Rs.30,000/year
 * but marginal for someone earning Rs.3,00,000/year.
 */
function benefitSignificanceScore(benefitAmount, annualIncome) {
  if (!benefitAmount || benefitAmount <= 0) return 0.3; // non-monetary still valuable
  if (!annualIncome || annualIncome <= 0) return 0.5;

  const ratio = benefitAmount / annualIncome;

  // Logarithmic scale: ratio=0.05 (5% of income) → ~0.5, ratio=0.5 → ~0.85, ratio=1+ → 1.0
  if (ratio >= 1.0) return 1.0;
  if (ratio >= 0.5) return 0.85;
  if (ratio >= 0.2) return 0.70;
  if (ratio >= 0.1) return 0.60;
  if (ratio >= 0.05) return 0.50;
  return 0.30;
}

/**
 * Eligibility comfort margin: how far is the user from the boundary?
 * A user at age 59 in a 18–60 scheme is "barely eligible" (score: 0.1).
 * A user at age 35 in the same scheme is "comfortably eligible" (score: 1.0).
 */
function eligibilityComfortScore(userAge, minAge, maxAge, userIncome, minIncome, maxIncome) {
  let ageScore = 1.0;
  if (minAge != null && maxAge != null && userAge != null) {
    const ageRange = maxAge - minAge;
    if (ageRange > 0) {
      // Distance from nearest boundary, normalised
      const distFromMin = userAge - minAge;
      const distFromMax = maxAge - userAge;
      const minDist = Math.min(distFromMin, distFromMax);
      ageScore = Math.max(0.1, Math.min(1.0, minDist / (ageRange / 2)));
    }
  }

  let incomeScore = 1.0;
  if (maxIncome != null && userIncome != null && maxIncome > 0) {
    // Closer to the max income limit = closer to the edge = lower comfort
    incomeScore = Math.max(0.1, 1.0 - (userIncome / maxIncome) * 0.8);
  }

  return (ageScore * 0.5) + (incomeScore * 0.5);
}

/**
 * Accessibility score: how barrier-free is the scheme for rural low-income users?
 * Penalises schemes requiring collateral, land, complex docs.
 */
function accessibilityScore(scheme) {
  let score = 0.8; // base — most govt schemes are fairly accessible

  if (scheme.requires_land)         score -= 0.1;
  if (scheme.requires_bank_account) score -= 0.05; // minor friction
  if (scheme.requires_jan_dhan)     score += 0.1;  // Jan Dhan = designed for poor

  // Tag-based bonuses
  const tags = (scheme.tags || []).join(' ');
  if (tags.includes('collateral_free')) score += 0.15;
  if (tags.includes('direct_benefit'))  score += 0.10;
  if (tags.includes('free'))            score += 0.05;

  return Math.min(1.0, Math.max(0.0, score));
}

// ---------------------------------------------------------------------------
// Main eligibility filter
// ---------------------------------------------------------------------------

/**
 * Returns true if the user passes ALL hard eligibility criteria for a scheme.
 * Any null criterion means "no restriction" — user passes by default.
 *
 * @param {Object} profile — row from financial_profiles + users JOIN
 * @param {Object} item    — row from schemes or insurance_policies table
 * @returns {boolean}
 */
function isEligible(profile, item) {
  // Age check
  if (item.min_age != null && profile.age != null && profile.age < item.min_age)       return false;
  if (item.max_age != null && profile.age != null && profile.age > item.max_age)       return false;

  // Income check
  if (item.min_annual_income != null && profile.annual_income != null &&
      parseFloat(profile.annual_income) < parseFloat(item.min_annual_income))          return false;
  if (item.max_annual_income != null && profile.annual_income != null &&
      parseFloat(profile.annual_income) > parseFloat(item.max_annual_income))          return false;

  // State check
  if (!arrayIncludes(item.eligible_states, profile.state))                             return false;

  // Gender check
  if (!arrayIncludes(item.eligible_genders, profile.gender))                           return false;

  // Caste check
  if (!arrayIncludes(item.eligible_castes, profile.caste_category))                    return false;

  // Occupation check
  if (!arrayIncludes(item.eligible_occupations, profile.occupation))                   return false;

  // Bank account requirement
  if (item.requires_bank_account && !profile.has_bank_account && !profile.has_jan_dhan_account) return false;

  // Jan Dhan requirement (insurance-specific)
  if (item.requires_jan_dhan && !profile.has_jan_dhan_account)                         return false;

  return true;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Runs the full recommendation pipeline: eligibility filter → scoring → ranking.
 *
 * @param {Object}   profile   — user's combined profile (financial_profiles + users)
 * @param {Array}    items     — array of scheme or insurance_policy rows
 * @param {string}   itemType  — 'scheme' | 'insurance'
 * @returns {Array}  — sorted array of items with `score` and `explanation` added
 */
function runRecommendationEngine(profile, items, itemType) {
  const W = currentWeights;

  const results = items
    // Step 1: Hard eligibility filter
    .filter(item => isEligible(profile, item))

    // Step 2: Score each eligible item
    .map(item => {
      const isInsurance = itemType === 'insurance';
      const isPremiumFree = isInsurance && (item.annual_premium === 0 || item.annual_premium == null);

      const gScore = goalRelevanceScore(
        profile.financial_goal,
        item.tags,
        item.category
      );
      const uScore = urgencyMatchScore(
        profile.urgency_level,
        isInsurance ? item.coverage_amount : item.benefit_amount,
        profile.goal_amount,
        isPremiumFree
      );
      const bScore = benefitSignificanceScore(
        isInsurance ? item.coverage_amount : item.benefit_amount,
        profile.annual_income
      );
      const eScore = eligibilityComfortScore(
        profile.age, item.min_age, item.max_age,
        profile.annual_income, item.min_annual_income, item.max_annual_income
      );
      const aScore = accessibilityScore(item);

      // Weighted composite score
      const score = parseFloat((
        W.goalRelevance       * gScore +
        W.urgencyMatch        * uScore +
        W.benefitSignificance * bScore +
        W.eligibilityComfort  * eScore +
        W.accessibility       * aScore
      ).toFixed(4));

      // Human-readable explanation (multilingual key references populated on the frontend)
      const explanation = {
        goal_match:          Math.round(gScore * 100),
        urgency_match:       Math.round(uScore * 100),
        benefit_relevance:   Math.round(bScore * 100),
        eligibility_comfort: Math.round(eScore * 100),
        accessibility:       Math.round(aScore * 100),
      };

      return { ...item, score, explanation };
    });

  // Step 3: Sort descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

module.exports = { runRecommendationEngine, DEFAULT_WEIGHTS };
