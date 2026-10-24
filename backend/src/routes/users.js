/**
 * ArthSathi — User routes (matches actual DB schema)
 *
 * Actual users table columns:
 *   id, phone, password_hash, full_name, preferred_language,
 *   monthly_income, occupation, state, age, gender,
 *   is_disabled, caste_category, bpl_card, ration_card,
 *   land_acres, num_children, marital_status, education_level,
 *   goals (json), telegram_id, whatsapp_number, created_at
 *
 * POST /api/users              — create/upsert user
 * GET  /api/users/:id          — get user by id
 * PUT  /api/users/:id          — update user
 * POST /api/users/:id/profile  — save financial profile (maps to same table)
 * GET  /api/users/:id/profile  — get financial profile
 */
'use strict';

const express = require('express');
const { query } = require('../db');
const { invalidateUserCache } = require('../services/groqRecommendation');
const router  = express.Router();

/* ── POST /api/users ──────────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const {
      phone_number,   // frontend sends phone_number → maps to phone column
      phone,          // also accept direct phone
      full_name,
      state,
      district,
      preferred_language = 'hi',
      interaction_mode   = 'text',
    } = req.body;

    const phoneVal = phone_number || phone || null;

    if (phoneVal) {
      // Check if user with this phone already exists
      const existing = await query(
        'SELECT id FROM users WHERE phone = $1',
        [phoneVal]
      );
      if (existing.rows.length > 0) {
        // Update + return existing user
        const result = await query(
          `UPDATE users SET
             full_name          = COALESCE($1, full_name),
             state              = COALESCE($2, state),
             preferred_language = $3,
             created_at         = created_at
           WHERE phone = $4
           RETURNING id, phone, full_name, preferred_language, state, created_at`,
          [full_name, state, preferred_language, phoneVal]
        );
        return res.status(200).json({ success: true, data: result.rows[0] });
      }

      // Insert new user with phone
      const result = await query(
        `INSERT INTO users (phone, full_name, state, preferred_language, aadhaar_verified, is_disabled, bpl_card, created_at)
         VALUES ($1, $2, $3, $4, FALSE, FALSE, FALSE, NOW())
         RETURNING id, phone, full_name, preferred_language, state, created_at`,
        [phoneVal, full_name || null, state || null, preferred_language]
      );
      return res.status(201).json({ success: true, data: result.rows[0] });
    }

    // No phone — anonymous user
    const result = await query(
      `INSERT INTO users (phone, full_name, state, preferred_language, aadhaar_verified, is_disabled, bpl_card, created_at)
       VALUES (NULL, $1, $2, $3, FALSE, FALSE, FALSE, NOW())
       RETURNING id, phone, full_name, preferred_language, state, created_at`,
      [full_name || null, state || null, preferred_language]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });

  } catch (err) {
    next(err);
  }
});

/* ── GET /api/users/:id ───────────────────────────────────────────── */
router.get('/:id', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Not found' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

/* ── PUT /api/users/:id ───────────────────────────────────────────── */
router.put('/:id', async (req, res, next) => {
  try {
    const { preferred_language, full_name, state } = req.body;
    const r = await query(
      `UPDATE users SET
         preferred_language = COALESCE($1, preferred_language),
         full_name          = COALESCE($2, full_name),
         state              = COALESCE($3, state)
       WHERE id = $4 RETURNING *`,
      [preferred_language, full_name, state, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Not found' } });
    invalidateUserCache(req.params.id); // bust recommendation cache on profile change
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

/* ── POST /api/users/:id/profile — save financial profile ─────────── */
router.post('/:id/profile', async (req, res, next) => {
  try {
    const uid = req.params.id;
    const b   = req.body;

    const monthlyIncome = parseFloat(b.monthly_income) || 0;

    // Update the users table directly (profile data lives there)
    const r = await query(
      `UPDATE users SET
         age                = COALESCE($1,  age),
         gender             = COALESCE($2,  gender),
         occupation         = COALESCE($3,  occupation),
         monthly_income     = COALESCE($4,  monthly_income),
         caste_category     = COALESCE($5,  caste_category),
         bpl_card           = COALESCE($6,  bpl_card),
         ration_card        = COALESCE($7,  ration_card),
         is_disabled        = COALESCE($8,  is_disabled),
         disability_type    = COALESCE($9,  disability_type),
         land_acres         = COALESCE($10, land_acres),
         num_children       = COALESCE($11, num_children),
         marital_status     = COALESCE($12, marital_status),
         education_level    = COALESCE($13, education_level),
         state              = COALESCE($14, state),
         goals              = COALESCE($15, goals)
       WHERE id = $16
       RETURNING *`,
      [
        b.age             ? parseInt(b.age) : null,
        b.gender          || null,
        b.occupation      || null,
        monthlyIncome     || null,
        b.caste_category  || null,
        b.is_bpl != null  ? b.is_bpl : null,
        b.ration_card_type || null,
        b.has_disability != null ? b.has_disability : null,
        b.disability_type || null,
        b.land_holding_acres ? parseFloat(b.land_holding_acres) : null,
        b.num_dependents  ? parseInt(b.num_dependents) : null,
        null, // marital_status not in onboarding
        b.education_level || null,
        b.state           || null,
        b.financial_goal  ? JSON.stringify({ goal: b.financial_goal, amount: b.goal_amount, urgency: b.urgency_level }) : null,
        uid,
      ]
    );

    if (!r.rows[0]) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    invalidateUserCache(uid); // bust recommendation cache on profile change
    res.status(200).json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

/* ── GET /api/users/:id/profile ──────────────────────────────────── */
router.get('/:id/profile', async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: { code: 'PROFILE_NOT_FOUND', message: 'User not found' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});


/* ── GET /api/users?phone=X  OR  ?telegram_id=X  OR  ?whatsapp=X ── */
router.get('/', async (req, res, next) => {
  try {
    const { phone, telegram_id, whatsapp } = req.query;
    let r;
    if (telegram_id) r = await query('SELECT * FROM users WHERE telegram_id = $1', [String(telegram_id)]);
    else if (whatsapp) r = await query('SELECT * FROM users WHERE whatsapp_number = $1', [whatsapp]);
    else if (phone)  r = await query('SELECT * FROM users WHERE phone = $1', [phone]);
    else return res.json({ success: true, data: [] });
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

module.exports = router;