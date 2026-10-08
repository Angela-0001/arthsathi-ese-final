"""
ArthSathi — Python Recommendation Engine
=========================================

This module implements the same eligibility filter and weighted scoring
algorithm as the Node.js recommendationService.js, with an additional
adaptive learning layer that periodically recalibrates scoring weights
based on real user interaction data from the database.

ALGORITHM OVERVIEW
==================
See inline comments for the formula. The JavaScript side (backend/src/services/
recommendationService.js) implements the same algorithm for synchronous in-process
use. The Python engine is used for:
  (a) Batch re-scoring when weights change
  (b) The adaptive weight recalibration cron job
  (c) Standalone testing / CLI use

ADAPTIVE WEIGHT LEARNING
========================
The scheduler calls `recalibrate_weights()` daily (or on-demand). This:
  1. Reads recent interaction_events from the DB (last 30 days)
  2. Builds a feature matrix: for each (user, scheme) pair seen, records the
     5 component scores at time of showing
  3. Labels: 1 if the user clicked or applied, 0 if dismissed or no action
  4. Trains a simple logistic-regression-style gradient update:
     weight_i ← weight_i + lr × (avg_gradient_i)
  5. Normalises so weights sum to 1
  6. Writes updated weights to weights.json (loaded by the Node backend)

This is a lightweight hand-written gradient update — no external ML framework
required. See docs/adaptive_learning.md for the full mathematical derivation.

CLI USAGE
=========
  python engine.py --recommend <user_id>     # get recommendations for a user
  python engine.py --recalibrate             # run one weight recalibration
  python engine.py --test                    # run against synthetic profiles
"""

import os
import re
import json
import time
import logging
import argparse
import datetime
from pathlib import Path
from typing import Optional

import psycopg2
import psycopg2.extras
import numpy as np
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
load_dotenv()

DB_CONFIG = {
    "host":     os.getenv("DB_HOST", "localhost"),
    "port":     int(os.getenv("DB_PORT", "5432")),
    "dbname":   os.getenv("DB_NAME", "arthsathi"),
    "user":     os.getenv("DB_USER", "postgres"),
    "password": os.getenv("DB_PASSWORD", "postgres"),
}

WEIGHTS_FILE = Path(__file__).parent / "weights.json"

# Default weights (must match recommendationService.js DEFAULT_WEIGHTS)
DEFAULT_WEIGHTS = {
    "goalRelevance":       0.30,
    "urgencyMatch":        0.20,
    "benefitSignificance": 0.25,
    "eligibilityComfort":  0.15,
    "accessibility":       0.10,
}

# Adaptive learning parameters
LEARNING_RATE        = 0.05   # How fast weights shift per recalibration
MIN_WEIGHT           = 0.05   # Floor so no component becomes irrelevant
INTERACTION_LOOKBACK = 30     # Days of interaction data to use

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("engine")

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_db():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=psycopg2.extras.RealDictCursor)


def load_weights() -> dict:
    """Load weights from file, fall back to defaults."""
    if WEIGHTS_FILE.exists():
        try:
            w = json.loads(WEIGHTS_FILE.read_text())
            if all(k in w for k in DEFAULT_WEIGHTS):
                log.info(f"Loaded weights from {WEIGHTS_FILE}")
                return w
        except Exception as e:
            log.warning(f"Could not read weights.json: {e}")
    return dict(DEFAULT_WEIGHTS)


def save_weights(weights: dict):
    """Persist weights to weights.json."""
    WEIGHTS_FILE.write_text(json.dumps(weights, indent=2))
    log.info(f"Saved weights: {weights}")

# ---------------------------------------------------------------------------
# Eligibility filter (mirrors recommendationService.js isEligible)
# ---------------------------------------------------------------------------

def is_eligible(profile: dict, item: dict) -> bool:
    """
    Hard eligibility check: returns True only if the user passes ALL criteria.
    A None criterion means "no restriction" — user passes by default.
    """
    age    = profile.get("age")
    income = float(profile.get("annual_income") or 0)
    state  = profile.get("state")
    gender = profile.get("gender")
    caste  = profile.get("caste_category")
    occ    = profile.get("occupation")
    bank   = profile.get("has_bank_account") or profile.get("has_jan_dhan_account")
    jandhan = profile.get("has_jan_dhan_account")

    # Age
    if item.get("min_age") is not None and age is not None and age < item["min_age"]:
        return False
    if item.get("max_age") is not None and age is not None and age > item["max_age"]:
        return False

    # Income
    if item.get("min_annual_income") and income < float(item["min_annual_income"]):
        return False
    if item.get("max_annual_income") and income > float(item["max_annual_income"]):
        return False

    # Arrays — if criterion is non-empty, user value must be in it
    def array_check(criterion, user_val):
        if not criterion:
            return True
        return user_val in criterion if user_val else False

    if not array_check(item.get("eligible_states"), state):
        return False
    if not array_check(item.get("eligible_genders"), gender):
        return False
    if not array_check(item.get("eligible_castes"), caste):
        return False
    if not array_check(item.get("eligible_occupations"), occ):
        return False

    # Bank account
    if item.get("requires_bank_account") and not bank:
        return False
    if item.get("requires_jan_dhan") and not jandhan:
        return False

    return True

# ---------------------------------------------------------------------------
# Score component functions (mirrors recommendationService.js)
# ---------------------------------------------------------------------------

def goal_relevance_score(goal: Optional[str], tags: list, category: str) -> float:
    """Keyword overlap between user's stated goal and scheme tags/category."""
    if not goal:
        return 0.3
    goal_words = re.sub(r"[^\w\s]", "", goal.lower()).split()
    goal_words = [w for w in goal_words if len(w) > 2]
    if not goal_words:
        return 0.3

    scheme_tokens = " ".join(tags + [category]).lower().split()

    matches = sum(
        1 for w in goal_words
        if any(t in w or w in t for t in scheme_tokens)
    )
    overlap = matches / len(goal_words)

    category_boosts = {
        "agriculture": ["farm", "kisan", "crop", "seed", "kharif", "rabi", "irrigation"],
        "health":      ["health", "medical", "hospital", "surgery", "ill", "disease", "medicine"],
        "housing":     ["house", "home", "pucca", "shelter", "construction", "roof"],
        "education":   ["school", "college", "study", "scholarship", "education", "tuition"],
        "employment":  ["job", "work", "employment", "wage", "daily", "labour", "labor"],
        "insurance":   ["insurance", "accident", "death", "life", "cover", "premium"],
    }
    boost_words = category_boosts.get(category, [])
    direct_hit = 0.2 if any(w in boost_words for w in goal_words) else 0

    return min(1.0, overlap + direct_hit)


def urgency_match_score(urgency: Optional[int], benefit: Optional[float],
                        goal_amount: Optional[float], is_free: bool) -> float:
    if not urgency:
        return 0.5
    urgency_factor = urgency / 5.0
    coverage = 0.5
    if benefit and goal_amount and goal_amount > 0:
        coverage = min(1.0, benefit / goal_amount)
    access = 1.0 if is_free else 0.7
    return urgency_factor * 0.5 + coverage * 0.3 + access * 0.2


def benefit_significance_score(benefit: Optional[float], annual_income: Optional[float]) -> float:
    if not benefit or benefit <= 0:
        return 0.3
    if not annual_income or annual_income <= 0:
        return 0.5
    ratio = benefit / annual_income
    if ratio >= 1.0:  return 1.0
    if ratio >= 0.5:  return 0.85
    if ratio >= 0.2:  return 0.70
    if ratio >= 0.1:  return 0.60
    if ratio >= 0.05: return 0.50
    return 0.30


def eligibility_comfort_score(age, min_age, max_age, income, min_income, max_income) -> float:
    age_score = 1.0
    if min_age is not None and max_age is not None and age is not None:
        age_range = max_age - min_age
        if age_range > 0:
            dist = min(age - min_age, max_age - age)
            age_score = max(0.1, min(1.0, dist / (age_range / 2)))

    income_score = 1.0
    if max_income and income and max_income > 0:
        income_score = max(0.1, 1.0 - (float(income) / float(max_income)) * 0.8)

    return age_score * 0.5 + income_score * 0.5


def accessibility_score(item: dict) -> float:
    score = 0.8
    if item.get("requires_land"):          score -= 0.1
    if item.get("requires_bank_account"):  score -= 0.05
    if item.get("requires_jan_dhan"):      score += 0.1
    tags = " ".join(item.get("tags") or [])
    if "collateral_free" in tags: score += 0.15
    if "direct_benefit"  in tags: score += 0.10
    if "free"            in tags: score += 0.05
    return max(0.0, min(1.0, score))


def score_components(profile: dict, item: dict, is_insurance: bool) -> dict:
    """Compute all 5 score components for a profile × item pair."""
    is_free = is_insurance and (not item.get("annual_premium") or float(item.get("annual_premium") or 0) == 0)
    benefit = float(item.get("coverage_amount") or 0) if is_insurance else float(item.get("benefit_amount") or 0)

    return {
        "goalRelevance":       goal_relevance_score(
            profile.get("financial_goal"), item.get("tags") or [], item.get("category", "other")
        ),
        "urgencyMatch":        urgency_match_score(
            profile.get("urgency_level"), benefit,
            float(profile.get("goal_amount") or 0) or None, is_free
        ),
        "benefitSignificance": benefit_significance_score(
            benefit, float(profile.get("annual_income") or 0) or None
        ),
        "eligibilityComfort":  eligibility_comfort_score(
            profile.get("age"),
            item.get("min_age"), item.get("max_age"),
            float(profile.get("annual_income") or 0),
            item.get("min_annual_income"), item.get("max_annual_income")
        ),
        "accessibility":       accessibility_score(item),
    }


def compute_score(components: dict, weights: dict) -> float:
    return sum(weights[k] * components[k] for k in weights)

# ---------------------------------------------------------------------------
# Main recommendation function
# ---------------------------------------------------------------------------

def recommend(profile: dict, items: list, is_insurance: bool, weights: dict) -> list:
    """
    Full pipeline: eligibility filter → score → rank.
    Returns list of items with `score` and `explanation` fields added.
    """
    results = []
    for item in items:
        if not is_eligible(profile, item):
            continue
        comps = score_components(profile, item, is_insurance)
        score = round(compute_score(comps, weights), 4)
        explanation = {k: round(v * 100) for k, v in comps.items()}
        results.append({**dict(item), "score": score, "explanation": explanation})

    results.sort(key=lambda x: x["score"], reverse=True)
    return results

# ---------------------------------------------------------------------------
# Adaptive weight recalibration
# ---------------------------------------------------------------------------

def recalibrate_weights():
    """
    Adaptive learning: update scoring weights based on user interaction data.

    ALGORITHM (hand-written gradient update)
    =========================================
    For each interaction event (view, click, apply, dismiss) in the last
    INTERACTION_LOOKBACK days:

    1. Retrieve the profile_snapshot stored at match time (from
       user_scheme_matches or user_insurance_matches).

    2. Recompute the 5 score components for that (profile, item) pair
       using current weights.

    3. Label: +1 if clicked/applied, -1 if dismissed, 0 if only viewed.

    4. Gradient for weight_i:
       ∂L/∂w_i = label × (component_i − mean_component_i)
       This is a simplified policy-gradient update: increase weights for
       components that correlate with positive engagement.

    5. New weight = old weight + lr × mean(gradients)
       Clip to [MIN_WEIGHT, 1.0], then normalise so Σ weights = 1.

    This is mathematically equivalent to a Naïve Bayes feature importance
    update trained on engagement as the label — suitable for the dataset
    size expected at launch (hundreds to thousands of interactions).
    """
    log.info("Starting adaptive weight recalibration...")
    conn = None
    try:
        conn = get_db()
        weights = load_weights()

        cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=INTERACTION_LOOKBACK)

        # Fetch recent scheme interaction events with profile snapshots
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    ie.event_type,
                    ie.entity_type,
                    usm.profile_snapshot,
                    s.id AS item_id,
                    s.tags, s.category, s.benefit_amount, s.min_age, s.max_age,
                    s.min_annual_income, s.max_annual_income,
                    s.requires_bank_account, s.requires_land,
                    false AS is_insurance,
                    NULL::numeric AS coverage_amount,
                    NULL::numeric AS annual_premium
                FROM interaction_events ie
                JOIN user_scheme_matches usm ON usm.user_id = ie.user_id
                    AND usm.scheme_id = ie.entity_id
                JOIN schemes s ON s.id = ie.entity_id
                WHERE ie.created_at > %s
                  AND ie.entity_type = 'scheme'
                  AND usm.profile_snapshot IS NOT NULL

                UNION ALL

                SELECT
                    ie.event_type,
                    ie.entity_type,
                    uim.profile_snapshot,
                    ip.id AS item_id,
                    ip.tags, ip.category, NULL::numeric AS benefit_amount,
                    ip.min_age, ip.max_age,
                    ip.min_annual_income, ip.max_annual_income,
                    ip.requires_bank_account, NULL::boolean AS requires_land,
                    true AS is_insurance,
                    ip.coverage_amount, ip.annual_premium
                FROM interaction_events ie
                JOIN user_insurance_matches uim ON uim.user_id = ie.user_id
                    AND uim.policy_id = ie.entity_id
                JOIN insurance_policies ip ON ip.id = ie.entity_id
                WHERE ie.created_at > %s
                  AND ie.entity_type = 'insurance'
                  AND uim.profile_snapshot IS NOT NULL
            """, (cutoff, cutoff))

            rows = cur.fetchall()

        if not rows:
            log.info("No interaction data found — weights unchanged")
            return weights

        log.info(f"Processing {len(rows)} interaction records for weight update")

        # Build gradient accumulators
        grad = {k: 0.0 for k in DEFAULT_WEIGHTS}
        count = 0

        # Component means for baseline subtraction
        comp_sums = {k: 0.0 for k in DEFAULT_WEIGHTS}
        comp_count = 0

        for row in rows:
            if not row["profile_snapshot"]:
                continue
            try:
                profile = row["profile_snapshot"]
                if isinstance(profile, str):
                    profile = json.loads(profile)

                item = {
                    "tags": row["tags"] or [],
                    "category": row["category"],
                    "benefit_amount": row.get("benefit_amount"),
                    "min_age": row.get("min_age"),
                    "max_age": row.get("max_age"),
                    "min_annual_income": row.get("min_annual_income"),
                    "max_annual_income": row.get("max_annual_income"),
                    "requires_bank_account": row.get("requires_bank_account"),
                    "requires_land": row.get("requires_land"),
                    "coverage_amount": row.get("coverage_amount"),
                    "annual_premium": row.get("annual_premium"),
                }

                comps = score_components(profile, item, bool(row["is_insurance"]))
                for k in comp_sums:
                    comp_sums[k] += comps[k]
                comp_count += 1

            except Exception:
                continue

        if comp_count == 0:
            log.info("Could not parse any interaction records")
            return weights

        # Compute means
        comp_means = {k: comp_sums[k] / comp_count for k in comp_sums}

        # Second pass: compute gradients
        for row in rows:
            if not row["profile_snapshot"]:
                continue
            try:
                profile = row["profile_snapshot"]
                if isinstance(profile, str):
                    profile = json.loads(profile)

                # Label: +1 for positive engagement, -1 for dismissal, 0 for view only
                label_map = {"apply": 1.0, "clicked": 0.8, "view": 0.0, "dismiss": -0.5}
                label = label_map.get(row["event_type"], 0.0)
                if label == 0.0:
                    continue  # Skip pure views — no signal

                item = {
                    "tags": row["tags"] or [],
                    "category": row["category"],
                    "benefit_amount": row.get("benefit_amount"),
                    "min_age": row.get("min_age"),
                    "max_age": row.get("max_age"),
                    "min_annual_income": row.get("min_annual_income"),
                    "max_annual_income": row.get("max_annual_income"),
                    "requires_bank_account": row.get("requires_bank_account"),
                    "requires_land": row.get("requires_land"),
                    "coverage_amount": row.get("coverage_amount"),
                    "annual_premium": row.get("annual_premium"),
                }
                comps = score_components(profile, item, bool(row["is_insurance"]))

                for k in grad:
                    # Gradient: label × (component − mean)
                    grad[k] += label * (comps[k] - comp_means[k])
                count += 1

            except Exception:
                continue

        if count == 0:
            log.info("No labelled interactions — weights unchanged")
            return weights

        # Normalise gradients
        for k in grad:
            grad[k] /= count

        log.info(f"Gradients (n={count}): {grad}")

        # Apply gradient update
        new_weights = {}
        for k in weights:
            new_weights[k] = weights[k] + LEARNING_RATE * grad.get(k, 0.0)
            new_weights[k] = max(MIN_WEIGHT, new_weights[k])

        # Renormalise to sum=1
        total = sum(new_weights.values())
        new_weights = {k: round(v / total, 4) for k, v in new_weights.items()}

        save_weights(new_weights)
        log.info(f"Weight recalibration complete. Old: {weights} → New: {new_weights}")
        return new_weights

    except Exception as e:
        log.error(f"Recalibration failed: {e}")
        return load_weights()
    finally:
        if conn:
            conn.close()

# ---------------------------------------------------------------------------
# Synthetic test profiles for verification
# ---------------------------------------------------------------------------

SYNTHETIC_PROFILES = [
    {
        "name": "Ramesh - SC farmer, 35yo, Maharashtra, low income",
        "profile": {
            "age": 35, "gender": "male", "caste_category": "sc",
            "occupation": "farmer", "state": "Maharashtra",
            "annual_income": 60000, "monthly_income": 5000,
            "total_debts": 20000, "num_dependents": 3,
            "has_bank_account": True, "has_jan_dhan_account": True,
            "ration_card_type": "BPL", "land_holding_acres": 2.0,
            "financial_goal": "buy seeds for kharif season",
            "goal_amount": 15000, "urgency_level": 4,
        },
    },
    {
        "name": "Savita - Daily wage labourer, 28yo, UP, no land",
        "profile": {
            "age": 28, "gender": "female", "caste_category": "obc",
            "occupation": "daily_wage", "state": "Uttar Pradesh",
            "annual_income": 36000, "monthly_income": 3000,
            "total_debts": 5000, "num_dependents": 2,
            "has_bank_account": True, "has_jan_dhan_account": False,
            "ration_card_type": "BPL", "land_holding_acres": 0,
            "financial_goal": "need money for house rent and food",
            "goal_amount": 10000, "urgency_level": 5,
        },
    },
    {
        "name": "Arjun - SC college student, 20yo, Tamil Nadu",
        "profile": {
            "age": 20, "gender": "male", "caste_category": "sc",
            "occupation": "unemployed", "state": "Tamil Nadu",
            "annual_income": 0, "monthly_income": 0,
            "total_debts": 0, "num_dependents": 0,
            "has_bank_account": True, "has_jan_dhan_account": False,
            "ration_card_type": "AAY", "land_holding_acres": 0,
            "financial_goal": "scholarship for college fees",
            "goal_amount": 50000, "urgency_level": 3,
        },
    },
]


def run_test():
    """Run the engine against synthetic profiles and print results."""
    conn = get_db()
    weights = load_weights()

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM schemes WHERE is_active = TRUE")
        schemes = [dict(r) for r in cur.fetchall()]

        cur.execute("SELECT * FROM insurance_policies WHERE is_active = TRUE")
        insurance = [dict(r) for r in cur.fetchall()]

    conn.close()

    print(f"\n{'='*70}")
    print("ArthSathi Recommendation Engine — Synthetic Profile Test")
    print(f"Active weights: {weights}")
    print(f"{'='*70}\n")

    for test in SYNTHETIC_PROFILES:
        name    = test["name"]
        profile = test["profile"]
        print(f"\n--- {name} ---")
        print(f"Goal: '{profile['financial_goal']}' (urgency: {profile['urgency_level']}/5)")

        scheme_recs  = recommend(profile, schemes, False, weights)
        insur_recs   = recommend(profile, insurance, True, weights)

        print(f"\n  Top Schemes ({len(scheme_recs)} eligible):")
        for i, r in enumerate(scheme_recs[:3], 1):
            print(f"    {i}. [{r['score']:.3f}] {r['name_en'][:60]}")
            exp = r.get("explanation", {})
            print(f"       goal={exp.get('goalRelevance','?')}% benefit={exp.get('benefitSignificance','?')}% urgency={exp.get('urgencyMatch','?')}%")

        print(f"\n  Top Insurance ({len(insur_recs)} eligible):")
        for i, r in enumerate(insur_recs[:2], 1):
            prem = r.get("annual_premium")
            print(f"    {i}. [{r['score']:.3f}] {r['name_en'][:55]} | premium: ₹{prem or 'variable'}")

    print(f"\n{'='*70}\n")

# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ArthSathi Recommendation Engine")
    parser.add_argument("--recommend", metavar="USER_ID", help="Get recommendations for a user")
    parser.add_argument("--recalibrate", action="store_true", help="Run adaptive weight recalibration")
    parser.add_argument("--test", action="store_true", help="Run against synthetic profiles")
    args = parser.parse_args()

    if args.recalibrate:
        recalibrate_weights()

    elif args.recommend:
        conn = get_db()
        weights = load_weights()
        with conn.cursor() as cur:
            cur.execute("""
                SELECT fp.*, u.state, u.district, u.preferred_language
                FROM financial_profiles fp
                JOIN users u ON u.id = fp.user_id
                WHERE fp.user_id = %s
            """, (args.recommend,))
            row = cur.fetchone()
            if not row:
                print(f"No profile found for user {args.recommend}")
                exit(1)
            profile = dict(row)

            cur.execute("SELECT * FROM schemes WHERE is_active = TRUE")
            schemes = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT * FROM insurance_policies WHERE is_active = TRUE")
            insurance = [dict(r) for r in cur.fetchall()]

        conn.close()

        scheme_recs = recommend(profile, schemes, False, weights)
        insur_recs  = recommend(profile, insurance, True, weights)

        print(json.dumps({
            "schemes": scheme_recs[:10],
            "insurance": insur_recs[:5],
            "weights_used": weights,
        }, indent=2, default=str))

    elif args.test:
        run_test()

    else:
        parser.print_help()
