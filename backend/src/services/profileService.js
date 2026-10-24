/**
 * ArthSathi — Profile Service
 *
 * Centralised access to user profile data with an in-memory TTL cache.
 * Every backend module that needs the user profile should go through
 * this service rather than querying the users table directly, so the
 * cache stays consistent and profile validation lives in one place.
 *
 * Responsibilities:
 *   - fetchUserProfile(userId)  — cached read with 5-minute TTL
 *   - updateProfile(userId, updates) — dynamic UPDATE + cache invalidation
 *   - isProfileComplete(profile)    — mandatory-field completeness check
 *   - validateProfile(profile)      — field-level validation
 *   - clearCache(userId)            — manual cache invalidation
 *
 * Uses the shared `pg` pool exposed by ../db.
 */

'use strict';

const { query } = require('../db');

// ─── Cache configuration ────────────────────────────────────────────────────
// A simple Map holds cache entries. Each entry is { data, timestamp }.
// The TTL is 5 minutes (300000 ms). After expiry the entry is treated as
// a miss and re-fetched from the database.
const CACHE_TTL_MS = 300000; // 5 minutes

/** @type {Map<string, { data: object, timestamp: number }>} */
const profileCache = new Map();

/**
 * Build the cache key for a given user id.
 * @param {string} userId
 * @returns {string}
 */
function cacheKey(userId) {
  return `profile:${userId}`;
}

/**
 * Returns a cached entry if it exists and is still fresh, otherwise null.
 * Stale entries are evicted on read so they don't leak memory.
 * @param {string} userId
 * @returns {object|null}
 */
function getCached(userId) {
  const key = cacheKey(userId);
  const entry = profileCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    // Expired — remove and treat as a miss.
    profileCache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Stores a profile in the cache with the current timestamp.
 * @param {string} userId
 * @param {object} profile
 */
function setCached(userId, profile) {
  profileCache.set(cacheKey(userId), {
    data: profile,
    timestamp: Date.now(),
  });
}

// ─── Custom error ───────────────────────────────────────────────────────────

/**
 * Thrown when a profile cannot be found for the given user id.
 */
class ProfileNotFoundError extends Error {
  constructor(userId) {
    super(`Profile not found for user ${userId}`);
    this.name = 'ProfileNotFoundError';
    this.userId = userId;
    this.code = 'PROFILE_NOT_FOUND';
  }
}

// ─── Validation constants ───────────────────────────────────────────────────

/** Fields that must be present for a profile to be considered complete. */
const MANDATORY_FIELDS = [
  'age',
  'gender',
  'state',
  'occupation',
  'monthly_income',
];

/** Allowed caste category values. */
const ALLOWED_CASTES = ['general', 'obc', 'sc', 'st', 'nt', 'vjnt'];

/** Allowed language codes (subset supported for profile input). */
const ALLOWED_LANGUAGES = ['en', 'hi', 'mr'];

/** Age boundaries — inclusive on both ends. */
const MIN_AGE = 0;
const MAX_AGE = 120;

/**
 * Canonical list of Indian states and union territories.
 * Comparisons are case-insensitive and trimmed, so the stored value
 * need not match the casing exactly.
 */
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Union Territories
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep',
  'Puducherry',
];

/** Case-insensitive lookup set for state validation. */
const INDIAN_STATES_LOWER = new Set(
  INDIAN_STATES.map((s) => s.toLowerCase())
);

/**
 * Columns that may be updated through updateProfile().
 * Whitelisting prevents SQL injection — any key not in this set is ignored.
 * Mirrors the profile-oriented fields stored on the users table.
 */
const UPDATABLE_COLUMNS = new Set([
  'full_name',
  'phone_number',
  'state',
  'district',
  'village',
  'village_town',
  'pincode',
  'preferred_language',
  'interaction_mode',
  'age',
  'gender',
  'occupation',
  'monthly_income',
  'caste_category',
  'goals',
  'bpl_card',
  'is_disabled',
]);

// ─── 1. fetchUserProfile ────────────────────────────────────────────────────

/**
 * Loads a user profile by id, served from a 5-minute in-memory cache when
 * available.
 *
 * @param {string} userId — UUID of the user
 * @returns {Promise<object>} the user profile row
 * @throws {ProfileNotFoundError} when no row exists for the given id
 */
async function fetchUserProfile(userId) {
  // 1. Check the cache first.
  const cached = getCached(userId);
  if (cached) return cached;

  // 2. Cache miss — fetch from the database.
  const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!result.rows.length) {
    throw new ProfileNotFoundError(userId);
  }

  const profile = result.rows[0];

  // 3. Populate the cache before returning.
  setCached(userId, profile);
  return profile;
}

// ─── 2. updateProfile ───────────────────────────────────────────────────────

/**
 * Updates a subset of profile columns for a user.
 *
 * Only whitelisted columns are applied; unknown keys are silently ignored
 * so callers can safely pass a partial object. Values are bound as
 * parameterised query arguments to prevent SQL injection.
 *
 * After a successful update the cached entry for the user is invalidated so
 * the next read reflects the new data.
 *
 * @param {string} userId  — UUID of the user to update
 * @param {object} updates — { column: value, ... } partial update
 * @returns {Promise<object|null>} the updated profile row, or null when
 *   no updatable columns were supplied / the user does not exist
 */
async function updateProfile(userId, updates) {
  // Filter to the whitelisted, non-null columns present in `updates`.
  const entries = Object.entries(updates).filter(
    ([column, value]) => UPDATABLE_COLUMNS.has(column) && value !== undefined
  );

  if (entries.length === 0) {
    return null;
  }

  // Build "col = $n" fragments and a matching parameter array.
  const setClauses = [];
  const params = [];
  entries.forEach(([column, value], index) => {
    params.push(value);
    setClauses.push(`${column} = $${index + 1}`);
  });

  // The WHERE clause parameter is appended after the SET parameters.
  params.push(userId);
  const whereParam = `$${params.length}`;

  const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = ${whereParam} RETURNING *`;

  const result = await query(sql, params);
  if (!result.rows.length) {
    // User did not exist — nothing to update. Invalidate just in case.
    clearCache(userId);
    return null;
  }

  const updated = result.rows[0];

  // Invalidate the stale cache entry; the next read will repopulate it.
  clearCache(userId);
  return updated;
}

// ─── 3. isProfileComplete ───────────────────────────────────────────────────

/**
 * Checks whether all mandatory profile fields are present and non-empty.
 *
 * A field is considered missing when it is null, undefined, an empty
 * string, or (for arrays/objects) has no entries.
 *
 * @param {object} profile — user profile row
 * @returns {{ isValid: boolean, missingFields: string[] }}
 */
function isProfileComplete(profile) {
  const missingFields = [];

  for (const field of MANDATORY_FIELDS) {
    const value = profile ? profile[field] : undefined;

    if (value == null) {
      missingFields.push(field);
      continue;
    }

    if (typeof value === 'string' && value.trim() === '') {
      missingFields.push(field);
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      missingFields.push(field);
      continue;
    }
  }

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

// ─── 4. validateProfile ─────────────────────────────────────────────────────

/**
 * Validates the editable fields of a profile against business rules.
 *
 * Rules:
 *   - age:          integer/number between 0 and 120 (inclusive) when present
 *   - monthly_income: numeric and non-negative when present
 *   - caste_category: one of [general, obc, sc, st, nt, vjnt] when present
 *   - preferred_language: one of [en, hi, mr] when present
 *   - state:        a valid Indian state/UT name (case-insensitive) when present
 *
 * Only fields that are present are validated; absent fields are skipped so
 * this can be used both for full profiles and partial updates.
 *
 * @param {object} profile — user profile row (or partial update)
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateProfile(profile) {
  const errors = [];

  if (!profile) {
    return { isValid: false, errors: ['Profile is required'] };
  }

  // Age
  if (profile.age != null) {
    const age = Number(profile.age);
    if (Number.isNaN(age) || !Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) {
      errors.push(`age must be an integer between ${MIN_AGE} and ${MAX_AGE}`);
    }
  }

  // Monthly income — non-negative number.
  if (profile.monthly_income != null) {
    const income = Number(profile.monthly_income);
    if (Number.isNaN(income) || income < 0) {
      errors.push('monthly_income must be a non-negative number');
    }
  }

  // Caste category.
  if (profile.caste_category != null && profile.caste_category !== '') {
    if (!ALLOWED_CASTES.includes(String(profile.caste_category).toLowerCase())) {
      errors.push(
        `caste_category must be one of: ${ALLOWED_CASTES.join(', ')}`
      );
    }
  }

  // Preferred language.
  if (profile.preferred_language != null && profile.preferred_language !== '') {
    if (!ALLOWED_LANGUAGES.includes(String(profile.preferred_language).toLowerCase())) {
      errors.push(
        `preferred_language must be one of: ${ALLOWED_LANGUAGES.join(', ')}`
      );
    }
  }

  // State — valid Indian state/UT, case-insensitive.
  if (profile.state != null && String(profile.state).trim() !== '') {
    if (!INDIAN_STATES_LOWER.has(String(profile.state).trim().toLowerCase())) {
      errors.push('state must be a valid Indian state or union territory');
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ─── 5. clearCache ──────────────────────────────────────────────────────────

/**
 * Manually removes a user's cached profile entry.
 *
 * Call this whenever a profile is mutated outside of updateProfile()
 * (for example by a raw query in another service) to keep the cache
 * consistent.
 *
 * @param {string} userId
 * @returns {boolean} true if an entry was removed, false if it was absent
 */
function clearCache(userId) {
  return profileCache.delete(cacheKey(userId));
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  fetchUserProfile,
  updateProfile,
  isProfileComplete,
  validateProfile,
  clearCache,
  ProfileNotFoundError,
  // Exposed for testing / diagnostics
  _cache: profileCache,
  _CACHE_TTL_MS: CACHE_TTL_MS,
};
