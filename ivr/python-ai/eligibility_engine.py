# -*- coding: utf-8 -*-
"""
eligibility_engine.py  –  IVR scheme matching
Loads from data/schemes.json (one directory up from this file).
Handles eligibility_rules as a DICT: {"field": [values]} or {"field": {"min":x,"max":y}}
Also queries backend API as a fallback.
"""

import json
import os
from pathlib import Path

import requests

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:3001")

# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def load_schemes() -> list:
    """
    Load schemes from  <ivr>/data/schemes.json.
    Handles both bare list and {"schemes": [...]} wrapper.
    """
    # python-ai/ lives at  <ivr>/python-ai/
    # data/        lives at  <ivr>/data/
    base = Path(__file__).resolve().parent.parent  # → <ivr>/
    path = base / "data" / "schemes.json"

    if not path.exists():
        print(f"[ENGINE] schemes.json not found at {path}")
        return []

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        if "schemes" in data:
            return data["schemes"]
        # Single scheme object
        if "scheme_id" in data:
            return [data]

    print(f"[ENGINE] Unrecognised schemes.json format")
    return []


# ---------------------------------------------------------------------------
# Eligibility checker for dict-format rules
# ---------------------------------------------------------------------------

def _check_rule_dict(rules: dict, profile: dict) -> bool:
    """
    rules is a dict like:
        {"occupation": ["farmer", "kisan"]}
        {"age": {"min": 18, "max": 60}, "annual_income": {"max": 500000}}

    Returns True if ALL rules are satisfied.
    Skips fields that are absent from the profile (assume eligible).
    """
    for field, condition in rules.items():
        if field not in profile:
            # We don't have the data – give benefit of the doubt
            continue

        raw_value = profile[field]

        if isinstance(condition, list):
            # Membership check (case-insensitive string compare)
            norm = str(raw_value).strip().lower()
            allowed = [str(v).strip().lower() for v in condition]
            if norm not in allowed:
                return False

        elif isinstance(condition, dict):
            # Range check
            try:
                num_value = float(raw_value)
            except (TypeError, ValueError):
                # Non-numeric profile value for a range rule – skip
                continue

            lo = condition.get("min")
            hi = condition.get("max")

            if lo is not None and num_value < float(lo):
                return False
            if hi is not None and num_value > float(hi):
                return False

        # Any other condition type: skip (don't disqualify)

    return True


def _check_exclusion_dict(rules: dict, profile: dict) -> bool:
    """
    Returns True if the profile is NOT excluded.
    exclusion_rules is also a dict like {"gender": ["male"]} – if matched, exclude.
    """
    if not rules:
        return True

    for field, condition in rules.items():
        if field not in profile:
            continue

        raw_value = profile[field]

        if isinstance(condition, list):
            norm = str(raw_value).strip().lower()
            excluded = [str(v).strip().lower() for v in condition]
            if norm in excluded:
                return False  # excluded

        elif isinstance(condition, dict):
            try:
                num_value = float(raw_value)
            except (TypeError, ValueError):
                continue

            lo = condition.get("min")
            hi = condition.get("max")
            if lo is not None and hi is not None:
                if float(lo) <= num_value <= float(hi):
                    return False  # excluded

    return True


# ---------------------------------------------------------------------------
# Legacy list-format checker (kept for backward compat with any old data)
# ---------------------------------------------------------------------------

def _check_rule_list(rules: list, profile: dict) -> bool:
    """Handle old-style list-of-rule-objects format."""
    for rule in rules:
        field    = rule.get("field")
        operator = rule.get("operator")
        required = rule.get("value")

        if field not in profile:
            return False

        user_val = profile[field]

        if operator == "equals":
            if user_val != required:
                return False
        elif operator == "in":
            if user_val not in required:
                return False
        elif operator == "less_than":
            if user_val >= required:
                return False
        elif operator == "less_than_or_equal":
            if user_val > required:
                return False
        elif operator == "greater_than_or_equal":
            if user_val < required:
                return False

    return True


# ---------------------------------------------------------------------------
# Main matcher
# ---------------------------------------------------------------------------

def find_matching_schemes(profile: dict) -> list:
    """
    Return a list of matching scheme dicts from data/schemes.json,
    supplemented by backend API results when no local match is found.
    """
    schemes = load_schemes()
    local_matches = []

    for scheme in schemes:
        eligibility_rules = scheme.get("eligibility_rules", {})
        exclusion_rules   = scheme.get("exclusion_rules", {})

        # --- Eligibility ---
        if isinstance(eligibility_rules, dict):
            eligible = _check_rule_dict(eligibility_rules, profile)
        elif isinstance(eligibility_rules, list):
            eligible = _check_rule_list(eligibility_rules, profile)
        else:
            eligible = True  # unknown format: don't disqualify

        if not eligible:
            continue

        # --- Exclusion ---
        if isinstance(exclusion_rules, dict):
            not_excluded = _check_exclusion_dict(exclusion_rules, profile)
        else:
            not_excluded = True

        if not not_excluded:
            continue

        local_matches.append(
            {
                "scheme_id": scheme.get("scheme_id"),
                "name":      scheme.get("name"),
                "benefits":  scheme.get("benefits"),
            }
        )

    # Backend API fallback / supplement
    api_matches = _query_backend(profile)

    # Merge, deduplicating by scheme_id
    seen_ids = {m.get("scheme_id") for m in local_matches if m.get("scheme_id")}
    for item in api_matches:
        sid = item.get("scheme_id") or item.get("_id") or item.get("id")
        if sid not in seen_ids:
            seen_ids.add(sid)
            local_matches.append(item)

    return local_matches


def _query_backend(profile: dict) -> list:
    """GET /api/schemes with a keyword built from the profile."""
    try:
        occupation = str(profile.get("occupation", "")).strip()
        category   = str(profile.get("social_category", "")).strip()
        keyword    = occupation or category or "farmer"

        resp = requests.get(
            f"{BACKEND_URL}/api/schemes",
            params={"q": keyword, "limit": 3},
            timeout=4,
        )
        if not resp.ok:
            return []

        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("schemes", [])
    except Exception as exc:
        print(f"[ENGINE] backend query failed: {exc}")

    return []


# ---------------------------------------------------------------------------
# Helpers kept for backward-compat with other importers
# ---------------------------------------------------------------------------

def get_required_fields_for_candidates(candidate_scheme_ids: list) -> list:
    schemes = load_schemes()
    required = set()
    for scheme in schemes:
        if scheme.get("scheme_id") in candidate_scheme_ids:
            for field in scheme.get("required_fields", []):
                required.add(field)
    return list(required)


def find_matching_insurance(profile: dict) -> list:
    insurance_type = profile.get("insurance_type")
    if not insurance_type:
        return []
    return [{"insurance_type": insurance_type, "match": True, "profile": profile}]


def load_insurance_rules() -> list:
    return []


def load_data_schemes() -> list:
    return load_schemes()