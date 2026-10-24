'use strict';

/**
 * Unit tests for profileService.js
 *
 * The pg pool is never touched — all DB access goes through the `query`
 * export from ../db, which we mock below with jest.mock().
 */

// ─── Mock ../db before any require of profileService ────────────────────────
jest.mock('../db', () => ({
  query: jest.fn(),
}));

const { query } = require('../db');
const {
  fetchUserProfile,
  isProfileComplete,
  validateProfile,
  clearCache,
  ProfileNotFoundError,
  _cache,
  _CACHE_TTL_MS,
} = require('./profileService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** A minimal valid user row returned by the DB. */
function makeUserRow(overrides = {}) {
  return {
    id: 'user-123',
    full_name: 'Ravi Kumar',
    age: 30,
    gender: 'male',
    state: 'Maharashtra',
    occupation: 'farmer',
    monthly_income: 8000,
    caste_category: 'obc',
    goals: ['pm_kisan', 'health_insurance'],
    ...overrides,
  };
}

/** A minimal complete profile object (all mandatory fields present). */
function makeCompleteProfile(overrides = {}) {
  return {
    age: 25,
    gender: 'female',
    state: 'Gujarat',
    occupation: 'daily_wage',
    monthly_income: 5000,
    caste_category: 'sc',
    goals: ['pm_awas'],
    ...overrides,
  };
}

// ─── 1. fetchUserProfile ─────────────────────────────────────────────────────

describe('fetchUserProfile', () => {
  beforeEach(() => {
    // Clear the in-memory cache and reset the mock between tests.
    _cache.clear();
    query.mockReset();
  });

  test('returns correct data when user exists', async () => {
    const row = makeUserRow();
    query.mockResolvedValueOnce({ rows: [row] });

    const profile = await fetchUserProfile('user-123');

    expect(profile).toEqual(row);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = $1',
      ['user-123']
    );
  });

  test('throws ProfileNotFoundError when user does not exist', async () => {
    // Two separate fetch calls → two DB queries (nothing is cached for a
    // not-found user, so each call hits the DB).
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(fetchUserProfile('no-such-user')).rejects.toThrow(
      ProfileNotFoundError
    );
    await expect(fetchUserProfile('no-such-user')).rejects.toMatchObject({
      name: 'ProfileNotFoundError',
      code: 'PROFILE_NOT_FOUND',
      userId: 'no-such-user',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('returns cached data on second call without hitting the DB', async () => {
    const row = makeUserRow();
    query.mockResolvedValueOnce({ rows: [row] });

    const first = await fetchUserProfile('user-123');
    const second = await fetchUserProfile('user-123');

    expect(first).toEqual(row);
    expect(second).toEqual(row);
    // Only one DB query — the second call was served from cache.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test('fetches fresh from DB after clearCache', async () => {
    const row = makeUserRow();
    const updatedRow = makeUserRow({ full_name: 'Ravi Updated' });
    query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [updatedRow] });

    await fetchUserProfile('user-123');   // populates cache
    clearCache('user-123');               // invalidates it
    const fresh = await fetchUserProfile('user-123'); // must go to DB again

    expect(fresh).toEqual(updatedRow);
    expect(query).toHaveBeenCalledTimes(2);
  });

  test('fetches fresh from DB after cache TTL expires', async () => {
    const row = makeUserRow();
    const staleRow = makeUserRow({ full_name: 'Stale Name' });
    query
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [staleRow] });

    // Seed a cache entry with a timestamp old enough to be expired.
    const expiredTimestamp = Date.now() - _CACHE_TTL_MS - 1;
    _cache.set(`profile:user-123`, { data: staleRow, timestamp: expiredTimestamp });

    // Fetch — the entry is expired so it should go to the DB.
    const result = await fetchUserProfile('user-123');

    expect(result).toEqual(row);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

// ─── 2. isProfileComplete ────────────────────────────────────────────────────

describe('isProfileComplete', () => {
  test('returns isValid:true when all mandatory fields are present', () => {
    const result = isProfileComplete(makeCompleteProfile());
    expect(result).toEqual({ isValid: true, missingFields: [] });
  });

  test('returns isValid:false and lists missing fields when none supplied', () => {
    const result = isProfileComplete({});
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toEqual(
      expect.arrayContaining(['age', 'gender', 'state', 'occupation',
        'monthly_income', 'caste_category', 'goals'])
    );
  });

  test('reports only the actually missing fields', () => {
    const profile = makeCompleteProfile({ age: undefined, caste_category: null });
    const result = isProfileComplete(profile);
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toContain('age');
    expect(result.missingFields).toContain('caste_category');
    expect(result.missingFields).not.toContain('gender');
    expect(result.missingFields).not.toContain('state');
  });

  test('treats empty string as missing', () => {
    const profile = makeCompleteProfile({ occupation: '  ' });
    const result = isProfileComplete(profile);
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toContain('occupation');
  });

  test('treats empty array for goals as missing', () => {
    const profile = makeCompleteProfile({ goals: [] });
    const result = isProfileComplete(profile);
    expect(result.isValid).toBe(false);
    expect(result.missingFields).toContain('goals');
  });

  test('handles null profile gracefully', () => {
    const result = isProfileComplete(null);
    expect(result.isValid).toBe(false);
    expect(result.missingFields.length).toBeGreaterThan(0);
  });
});

// ─── 3. validateProfile ──────────────────────────────────────────────────────

describe('validateProfile', () => {
  // ── Age ──────────────────────────────────────────────────────────────────

  test('accepts age at lower boundary (0)', () => {
    const { isValid, errors } = validateProfile({ age: 0 });
    expect(isValid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  test('accepts age at upper boundary (120)', () => {
    const { isValid } = validateProfile({ age: 120 });
    expect(isValid).toBe(true);
  });

  test('rejects age of -1 (below minimum)', () => {
    const { isValid, errors } = validateProfile({ age: -1 });
    expect(isValid).toBe(false);
    expect(errors.some((e) => /age/.test(e))).toBe(true);
  });

  test('rejects age of 121 (above maximum)', () => {
    const { isValid, errors } = validateProfile({ age: 121 });
    expect(isValid).toBe(false);
    expect(errors.some((e) => /age/.test(e))).toBe(true);
  });

  test('rejects non-integer age (float)', () => {
    const { isValid } = validateProfile({ age: 25.5 });
    expect(isValid).toBe(false);
  });

  // ── Monthly income ────────────────────────────────────────────────────────

  test('accepts monthly_income of 0', () => {
    const { isValid } = validateProfile({ monthly_income: 0 });
    expect(isValid).toBe(true);
  });

  test('accepts positive monthly_income', () => {
    const { isValid } = validateProfile({ monthly_income: 12000 });
    expect(isValid).toBe(true);
  });

  test('rejects negative monthly_income', () => {
    const { isValid, errors } = validateProfile({ monthly_income: -500 });
    expect(isValid).toBe(false);
    expect(errors.some((e) => /monthly_income/.test(e))).toBe(true);
  });

  // ── Caste category ────────────────────────────────────────────────────────

  test.each(['general', 'obc', 'sc', 'st', 'nt', 'vjnt'])(
    'accepts valid caste_category "%s"',
    (caste) => {
      const { isValid } = validateProfile({ caste_category: caste });
      expect(isValid).toBe(true);
    }
  );

  test('accepts caste_category in upper case (case-insensitive)', () => {
    const { isValid } = validateProfile({ caste_category: 'OBC' });
    expect(isValid).toBe(true);
  });

  test('rejects unknown caste_category', () => {
    const { isValid, errors } = validateProfile({ caste_category: 'brahmin' });
    expect(isValid).toBe(false);
    expect(errors.some((e) => /caste_category/.test(e))).toBe(true);
  });

  // ── State ─────────────────────────────────────────────────────────────────

  test('accepts a valid Indian state', () => {
    const { isValid } = validateProfile({ state: 'Maharashtra' });
    expect(isValid).toBe(true);
  });

  test('accepts state in different casing (case-insensitive)', () => {
    const { isValid } = validateProfile({ state: 'MAHARASHTRA' });
    expect(isValid).toBe(true);
  });

  test('accepts a union territory (Delhi)', () => {
    const { isValid } = validateProfile({ state: 'Delhi' });
    expect(isValid).toBe(true);
  });

  test('rejects a non-existent state', () => {
    const { isValid, errors } = validateProfile({ state: 'Atlantis' });
    expect(isValid).toBe(false);
    expect(errors.some((e) => /state/.test(e))).toBe(true);
  });

  // ── Null / absent fields are skipped ─────────────────────────────────────

  test('skips validation for absent fields (partial update)', () => {
    // Only monthly_income provided — no age, state, etc.
    const { isValid } = validateProfile({ monthly_income: 3000 });
    expect(isValid).toBe(true);
  });

  test('returns error when called with null profile', () => {
    const { isValid, errors } = validateProfile(null);
    expect(isValid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  // ── Combined valid profile ─────────────────────────────────────────────────

  test('passes a fully valid profile with all checked fields', () => {
    const { isValid, errors } = validateProfile({
      age: 35,
      monthly_income: 15000,
      caste_category: 'general',
      state: 'Uttar Pradesh',
      preferred_language: 'hi',
    });
    expect(isValid).toBe(true);
    expect(errors).toHaveLength(0);
  });
});
