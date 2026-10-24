/**
 * ArthSathi — Scheme & Insurance Recommendation Routes (v2)
 *
 * GET  /api/schemes                  — list all active schemes (paginated, searchable)
 * GET  /api/schemes/:id              — scheme detail
 * POST /api/schemes/recommend        — personalised recommendations via Python engine
 * POST /api/schemes/event            — log interaction event
 *
 * GET  /api/insurance                — list insurance policies
 * GET  /api/insurance/:id            — policy detail
 * POST /api/insurance/recommend      — personalised insurance recs via Python engine
 */

const express = require('express');
const { query }                  = require('../db');
const { getRecommendations, logEvent, isEngineHealthy } = require('../services/engineService');
const { fetchUserProfile, isProfileComplete, ProfileNotFoundError } = require('../services/profileService');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/schemes — paginated list with optional search
router.get('/', async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit    = Math.min(50, parseInt(req.query.limit || '20', 10));
    const offset   = (page - 1) * limit;
    const category = req.query.category;
    const search   = req.query.q;

    let sql = `SELECT id, scheme_id, name, description, category, ministry,
                      min_age, max_age, max_income, benefit_value,
                      application_url, last_refreshed, engagement_weight
               FROM schemes WHERE is_active = TRUE`;
    const params = [];

    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (name::text ILIKE $${params.length} OR COALESCE(description::text,'') ILIKE $${params.length})`;
    }

    sql += ` ORDER BY engagement_weight DESC NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    const countResult = await query(
      `SELECT COUNT(*) FROM schemes WHERE is_active = TRUE${category ? ' AND category = $1' : ''}`,
      category ? [category] : []
    );

    res.json({
      success: true,
      data:    result.rows,
      pagination: { page, limit, total: parseInt(countResult.rows[0].count, 10) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/schemes/:id — single scheme detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM schemes WHERE id = $1 OR scheme_id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'SCHEME_NOT_FOUND', message: 'Scheme not found' } });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/schemes/recommend — personalised recommendations
router.post('/recommend', async (req, res, next) => {
  try {
    const { user_id, limit = 10 } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER_ID', message: 'user_id required' } });
    }

    // Fetch profile via ProfileService (cached, with validation)
    let profile;
    try {
      profile = await fetchUserProfile(user_id);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      throw err;
    }
    const completeness = isProfileComplete(profile);
    if (!completeness.isValid) {
      return res.status(400).json({ success: false, error: { code: 'INCOMPLETE_PROFILE', message: 'Profile incomplete', missingFields: completeness.missingFields } });
    }

    console.log(`[Recommend] ${new Date().toISOString()} user=${user_id} platform=web requesting schemes`);

    // Try Groq AI recommendation if key is set
    if (process.env.GROQ_API_KEY) {
      try {
        const { getRelevantSchemes } = require('../services/groqRecommendation');
        const schemes = await getRelevantSchemes(user_id, limit);
        return res.json({ success: true, source: 'groq', data: schemes });
      } catch (e) {
        console.error('[Schemes] Groq error:', e.message);
      }
    }

    // Try ML engine
    const engineUp = await isEngineHealthy();
    if (engineUp) {
      try {
        const result = await getRecommendations(user_id, { limit, itemType: 'scheme' });
        return res.json({ success: true, source: 'engine', data: result.schemes || [] });
      } catch (e) {
        console.error('[Schemes] Engine error:', e.message);
      }
    }

    // No AI available — return empty, tell user to set up
    res.json({
      success: true,
      source: 'none',
      data: [],
      message: 'No recommendation engine available. Please set GROQ_API_KEY in backend/.env'
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/schemes/interact — log apply/dismiss for collaborative filtering
router.post('/interact', async (req, res, next) => {
  try {
    const { user_id, scheme_id, action } = req.body; // action: 'apply' | 'dismiss'
    if (!user_id || !scheme_id || !action) {
      return res.status(400).json({ success: false, error: 'user_id, scheme_id, action required' });
    }
    await query(
      `INSERT INTO item_interactions (user_id, item_id, item_type, interaction_type, created_at)
       VALUES ($1, $2, 'scheme', $3, NOW())
       ON CONFLICT DO NOTHING`,
      [user_id, String(scheme_id), action]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/schemes/signals?user_id=X — get scheme scores boosted by similar users
// Similar users = same occupation + caste_category
router.get('/signals', async (req, res, next) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.json({ success: true, boosts: {}, suppressions: {} });

    // Get this user's profile
    const userRes = await query(
      'SELECT occupation, caste_category FROM users WHERE id = $1',
      [user_id]
    );
    if (!userRes.rows.length) return res.json({ success: true, boosts: {}, suppressions: {} });
    const { occupation, caste_category } = userRes.rows[0];

    // Find similar users (same occupation + caste)
    const similarRes = await query(
      `SELECT id FROM users WHERE occupation = $1 AND caste_category = $2 AND id != $3 LIMIT 100`,
      [occupation, caste_category, user_id]
    );
    if (!similarRes.rows.length) return res.json({ success: true, boosts: {}, suppressions: {} });
    const similarIds = similarRes.rows.map(r => r.id);

    // Get their interactions
    const intRes = await query(
      `SELECT item_id, interaction_type, COUNT(*) as cnt
       FROM item_interactions
       WHERE user_id = ANY($1) AND item_type = 'scheme'
       GROUP BY item_id, interaction_type`,
      [similarIds]
    );

    const boosts = {};
    const suppressions = {};
    for (const row of intRes.rows) {
      if (row.interaction_type === 'apply') {
        boosts[row.item_id] = (boosts[row.item_id] || 0) + parseInt(row.cnt);
      } else if (row.interaction_type === 'dismiss') {
        suppressions[row.item_id] = (suppressions[row.item_id] || 0) + parseInt(row.cnt);
      }
    }

    res.json({ success: true, boosts, suppressions });
  } catch (err) { next(err); }
});

// POST /api/schemes/event — log interaction
router.post('/event', async (req, res, next) => {
  try {
    const { user_id, entity_id, event_type, rank_position, session_id,
            client_event_id, dwell_time_ms, score_breakdown } = req.body;

    // Try engine first (for adaptive learning)
    try {
      await logEvent({
        user_id, entity_type: 'scheme', entity_id, event_type,
        rank_position, session_id, client_event_id, dwell_time_ms, score_breakdown,
      });
    } catch {
      // Engine down — log directly to DB
    }

    // Always log to DB as well
    try {
      await query(
        `INSERT INTO interaction_events
         (user_id, session_id, event_type, entity_type, entity_id, rank_position,
          score_breakdown, dwell_time_ms, client_event_id, device_type)
         VALUES ($1,$2,$3::match_action_t,$4,$5,$6,$7::jsonb,$8,$9,'web')
         ON CONFLICT (client_event_id) DO NOTHING`,
        [user_id, session_id, event_type, 'scheme', entity_id, rank_position,
         score_breakdown ? JSON.stringify(score_breakdown) : null,
         dwell_time_ms, client_event_id || `${user_id}_${entity_id}_${Date.now()}`]
      );
    } catch (dbErr) {
      console.warn('[Event] DB log error (non-fatal):', dbErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INSURANCE
// ─────────────────────────────────────────────────────────────────────────────

const insuranceRouter = express.Router();

// GET /api/insurance — paginated list
insuranceRouter.get('/', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(50, parseInt(req.query.limit || '20', 10));
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT id, source_id, name, description, category, tags,
              annual_premium, coverage_amount, coverage_type, application_url,
              min_age, max_age, administered_by
       FROM insurance_policies WHERE is_active = TRUE
       ORDER BY annual_premium ASC NULLS LAST LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countResult = await query('SELECT COUNT(*) FROM insurance_policies WHERE is_active = TRUE');

    res.json({
      success: true,
      data:    result.rows,
      pagination: { page, limit, total: parseInt(countResult.rows[0].count, 10) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/insurance/:id
insuranceRouter.get('/:id', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM insurance_policies WHERE id = $1 OR source_id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' } });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/insurance/recommend
insuranceRouter.post('/recommend', async (req, res, next) => {
  try {
    const { user_id, limit = 5 } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER_ID', message: 'user_id required' } });
    }

    // Fetch profile via ProfileService (cached, with validation)
    let profile;
    try {
      profile = await fetchUserProfile(user_id);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      throw err;
    }
    const completeness = isProfileComplete(profile);
    if (!completeness.isValid) {
      return res.status(400).json({ success: false, error: { code: 'INCOMPLETE_PROFILE', message: 'Profile incomplete', missingFields: completeness.missingFields } });
    }

    console.log(`[Recommend] ${new Date().toISOString()} user=${user_id} platform=web requesting schemes`);

    // Try Groq AI recommendation if key is set
    if (process.env.GROQ_API_KEY) {
      try {
        const { getRelevantInsurance } = require('../services/groqRecommendation');
        const policies = await getRelevantInsurance(user_id, limit);
        return res.json({ success: true, source: 'groq', data: policies });
      } catch (e) {
        console.error('[Insurance] Groq error:', e.message);
      }
    }

    // Try ML engine
    const engineUp = await isEngineHealthy();
    if (engineUp) {
      try {
        const result = await getRecommendations(user_id, { limit, itemType: 'insurance' });
        return res.json({ success: true, source: 'engine', data: result.insurance || [] });
      } catch (e) {
        console.error('[Insurance] Engine error:', e.message);
      }
    }

    // No AI available — return all policies (real data, no AI filtering)
    const allPolicies = await query(
      `SELECT id, source_id, name, description, category,
              annual_premium, coverage_amount, coverage_type,
              application_url, min_age, max_age, administered_by
       FROM insurance_policies
       WHERE is_active = TRUE
       ORDER BY annual_premium ASC NULLS FIRST
       LIMIT $1`,
      [limit]
    );

    res.json({ success: true, source: 'fallback', data: allPolicies.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = { schemesRouter: router, insuranceRouter };
