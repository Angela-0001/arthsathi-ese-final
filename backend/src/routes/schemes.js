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

    let sql    = `SELECT id, source_id, name, description, category, tags, benefit_type,
                         benefit_amount_min, benefit_amount_max, level, ministry,
                         application_url, last_scraped_at
                  FROM schemes WHERE is_active = TRUE`;
    const params = [];

    if (category) {
      params.push(category);
      sql += ` AND category = $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (name->>'en' ILIKE $${params.length} OR name->>'hi' ILIKE $${params.length})`;
    }

    sql += ` ORDER BY last_scraped_at DESC NULLS LAST LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result      = await query(sql, params);
    const countResult = await query(
      `SELECT COUNT(*) FROM schemes WHERE is_active = TRUE
       ${category ? ' AND category = $1' : ''}
       ${search ? ` AND name->>'en' ILIKE $${category ? 2 : 1}` : ''}`,
      [...(category ? [category] : []), ...(search ? [`%${search}%`] : [])]
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
      'SELECT * FROM schemes WHERE id = $1 OR source_id = $1',
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
    const { user_id, session_id, limit = 10 } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER_ID', message: 'user_id required' } });
    }

    // Check engine is up
    const engineUp = await isEngineHealthy();
    if (!engineUp) {
      // Fall back to last cached matches from DB
      const cached = await query(
        `SELECT usm.*, s.name, s.description, s.category, s.benefit_type,
                s.benefit_amount_min, s.benefit_amount_max, s.application_url,
                s.tags, s.ministry
         FROM user_scheme_matches usm
         JOIN schemes s ON s.id = usm.scheme_id
         WHERE usm.user_id = $1
         ORDER BY usm.score DESC
         LIMIT $2`,
        [user_id, limit]
      );
      return res.json({
        success: true,
        source: 'cache',
        offline: true,
        data: cached.rows,
      });
    }

    const result = await getRecommendations(user_id, {
      limit,
      itemType: 'scheme',
      sessionId: session_id,
    });

    res.json({
      success: true,
      source: 'engine',
      data:   result.schemes || [],
      session_id:    result.session_id,
      weights_used:  result.weights_used,
      profile_summary: result.profile_summary,
    });

  } catch (err) {
    // If engine call fails, try cache first, then fallback to top schemes
    console.error('[Schemes] Engine error, falling back:', err.message);
    try {
      const { user_id, limit = 10 } = req.body;
      
      // Try cached matches first
      const cached = await query(
        `SELECT usm.scheme_id as id, usm.score, s.name, s.description, s.category,
                s.benefit_type, s.benefit_amount_min, s.benefit_amount_max,
                s.application_url, s.tags, s.ministry, s.source_id,
                usm.explain_text, usm.eligibility_status, usm.score_breakdown
         FROM user_scheme_matches usm
         JOIN schemes s ON s.id = usm.scheme_id
         WHERE usm.user_id = $1
         ORDER BY usm.score DESC LIMIT $2`,
        [user_id, limit]
      );
      
      if (cached.rows.length > 0) {
        return res.json({ success: true, source: 'cache', offline: true, data: cached.rows });
      }
      
      // No cache, return top popular schemes as fallback
      console.log('[Schemes] No cache, returning popular schemes');
      const popular = await query(
        `SELECT id, source_id, name, description, category, tags, benefit_type,
                benefit_amount_min, benefit_amount_max, application_url, ministry, level,
                0.5 as score, 'No profile data yet - showing popular schemes' as explain_text,
                'unknown' as eligibility_status
         FROM schemes
         WHERE is_active = TRUE
         ORDER BY 
           CASE WHEN level = 'central' THEN 0 ELSE 1 END,
           benefit_amount_max DESC NULLS LAST
         LIMIT $1`,
        [limit]
      );
      
      res.json({ 
        success: true, 
        source: 'fallback', 
        offline: true, 
        data: popular.rows,
        message: 'Recommendation engine unavailable. Showing popular schemes.'
      });
    } catch (e2) {
      console.error('[Schemes] Fallback error:', e2.message);
      next(err);
    }
  }
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
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT id, source_id, name, description, category, tags, benefit_type,
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
    const { user_id, session_id, limit = 5 } = req.body;
    if (!user_id) {
      return res.status(400).json({ success: false, error: { code: 'MISSING_USER_ID', message: 'user_id required' } });
    }

    const engineUp = await isEngineHealthy();
    if (!engineUp) {
      const cached = await query(
        `SELECT uim.*, p.name, p.description, p.annual_premium, p.coverage_amount
         FROM user_insurance_matches uim
         JOIN insurance_policies p ON p.id = uim.policy_id
         WHERE uim.user_id = $1 ORDER BY uim.score DESC LIMIT $2`,
        [user_id, limit]
      );
      return res.json({ success: true, source: 'cache', offline: true, data: cached.rows });
    }

    const result = await getRecommendations(user_id, {
      limit,
      itemType: 'insurance',
      sessionId: session_id,
    });

    res.json({
      success: true,
      source:  'engine',
      data:    result.insurance || [],
      session_id: result.session_id,
    });

  } catch (err) {
    // If engine call fails, try cache first, then fallback to all insurance
    console.error('[Insurance] Engine error, falling back:', err.message);
    try {
      const { user_id, limit = 5 } = req.body;
      
      // Try cached matches first
      const cached = await query(
        `SELECT uim.policy_id as id, uim.score, p.name, p.description, 
                p.annual_premium, p.coverage_amount, p.coverage_type,
                p.application_url, p.source_id,
                uim.explain_text, uim.eligibility_status
         FROM user_insurance_matches uim
         JOIN insurance_policies p ON p.id = uim.policy_id
         WHERE uim.user_id = $1
         ORDER BY uim.score DESC LIMIT $2`,
        [user_id, limit]
      );
      
      if (cached.rows.length > 0) {
        return res.json({ success: true, source: 'cache', offline: true, data: cached.rows });
      }
      
      // No cache, return all insurance policies
      console.log('[Insurance] No cache, returning all policies');
      const allPolicies = await query(
        `SELECT id, source_id, name, description, category, tags,
                annual_premium, coverage_amount, coverage_type, application_url,
                0.5 as score, 'Showing all available insurance policies' as explain_text,
                'unknown' as eligibility_status
         FROM insurance_policies
         WHERE is_active = TRUE
         ORDER BY annual_premium ASC NULLS FIRST
         LIMIT $1`,
        [limit]
      );
      
      res.json({ 
        success: true, 
        source: 'fallback', 
        offline: true, 
        data: allPolicies.rows,
        message: 'Recommendation engine unavailable. Showing all insurance policies.'
      });
    } catch (e2) {
      console.error('[Insurance] Fallback error:', e2.message);
      next(err);
    }
  }
});

module.exports = { schemesRouter: router, insuranceRouter };
