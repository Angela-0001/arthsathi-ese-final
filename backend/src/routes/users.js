/**
 * ArthSathi — User routes (v2, matches new schema)
 *
 * POST /api/users                — create/upsert user
 * GET  /api/users/:id            — get user
 * PUT  /api/users/:id            — update preferences
 * POST /api/users/:id/profile    — save financial profile
 * GET  /api/users/:id/profile    — fetch financial profile
 */
'use strict';

const express = require('express');
const { query } = require('../db');
const router  = express.Router();

/* ── POST /api/users ──────────────────────────────────────────────── */
router.post('/', async (req, res, next) => {
  try {
    const {
      phone_number,
      full_name,
      state,
      district,
      village_town,
      residence_type,
      preferred_language = 'hi',
      interaction_mode   = 'voice',
    } = req.body;

    // phone is nullable — handle upsert manually to avoid partial-index ON CONFLICT issue
    let result;
    if (phone_number) {
      // Check if user with this phone already exists
      const existing = await query(
        'SELECT id FROM users WHERE phone_number = $1',
        [phone_number]
      );
      if (existing.rows.length > 0) {
        // Update existing user
        result = await query(
          `UPDATE users SET
             full_name          = COALESCE($1, full_name),
             state              = COALESCE($2, state),
             district           = COALESCE($3, district),
             preferred_language = $4,
             interaction_mode   = $5,
             updated_at         = NOW()
           WHERE phone_number = $6
           RETURNING *`,
          [full_name, state, district, preferred_language, interaction_mode, phone_number]
        );
      } else {
        // Insert new user with phone
        result = await query(
          `INSERT INTO users
             (phone_number, full_name, state, district, village_town,
              residence_type, preferred_language, interaction_mode, consent_given_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           RETURNING *`,
          [phone_number, full_name, state, district,
           village_town, residence_type, preferred_language, interaction_mode]
        );
      }
    } else {
      // No phone — always insert new anonymous user
      result = await query(
        `INSERT INTO users
           (phone_number, full_name, state, district, village_town,
            residence_type, preferred_language, interaction_mode, consent_given_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         RETURNING *`,
        [null, full_name, state, district,
         village_town, residence_type, preferred_language, interaction_mode]
      );
    }

    res.status(201).json({ success: true, data: result.rows[0] });
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
    const { preferred_language, interaction_mode, full_name, state, district } = req.body;
    const r = await query(
      `UPDATE users SET
         preferred_language = COALESCE($1, preferred_language),
         interaction_mode   = COALESCE($2, interaction_mode),
         full_name          = COALESCE($3, full_name),
         state              = COALESCE($4, state),
         district           = COALESCE($5, district),
         updated_at         = NOW()
       WHERE id = $6 RETURNING *`,
      [preferred_language, interaction_mode, full_name, state, district, req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Not found' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

/* ── POST /api/users/:id/profile ─────────────────────────────────── */
router.post('/:id/profile', async (req, res, next) => {
  try {
    const uid = req.params.id;
    const b   = req.body;

    const monthlyIncome = parseFloat(b.monthly_income) || 0;
    const annualIncome  = parseFloat(b.annual_income)  || monthlyIncome * 12;

    const r = await query(
      `INSERT INTO financial_profiles (
         user_id,
         age, gender, marital_status, religion, caste_category, is_minority,
         occupation, sub_occupation,
         monthly_income, annual_income, family_monthly_income, family_annual_income,
         total_debts, land_holding_acres, num_dependents,
         is_bpl, ration_card_type, ration_card_state_label, ration_card_member_count,
         has_bank_account, has_jan_dhan_account, has_aadhaar, has_kisan_credit_card,
         has_girl_child, num_girl_children, is_widow, is_divorcee, is_senior_citizen,
         education_level, is_student, student_class_level,
         has_disability, disability_type, disability_percentage, has_disability_certificate,
         financial_goal, goal_description, goal_amount, goal_timeframe_months, urgency_level,
         completed_at
       ) VALUES (
         $1,
         $2,$3,$4,$5,$6,$7,
         $8,$9,
         $10,$11,$12,$13,
         $14,$15,$16,
         $17,$18,$19,$20,
         $21,$22,$23,$24,
         $25,$26,$27,$28,$29,
         $30,$31,$32,
         $33,$34,$35,$36,
         $37,$38,$39,$40,$41,
         NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         age                   = COALESCE(EXCLUDED.age,                   financial_profiles.age),
         gender                = COALESCE(EXCLUDED.gender,                financial_profiles.gender),
         marital_status        = COALESCE(EXCLUDED.marital_status,        financial_profiles.marital_status),
         caste_category        = COALESCE(EXCLUDED.caste_category,        financial_profiles.caste_category),
         occupation            = COALESCE(EXCLUDED.occupation,            financial_profiles.occupation),
         monthly_income        = COALESCE(EXCLUDED.monthly_income,        financial_profiles.monthly_income),
         annual_income         = COALESCE(EXCLUDED.annual_income,         financial_profiles.annual_income),
         total_debts           = COALESCE(EXCLUDED.total_debts,           financial_profiles.total_debts),
         land_holding_acres    = COALESCE(EXCLUDED.land_holding_acres,    financial_profiles.land_holding_acres),
         num_dependents        = COALESCE(EXCLUDED.num_dependents,        financial_profiles.num_dependents),
         is_bpl                = COALESCE(EXCLUDED.is_bpl,                financial_profiles.is_bpl),
         ration_card_type      = COALESCE(EXCLUDED.ration_card_type,      financial_profiles.ration_card_type),
         has_bank_account      = COALESCE(EXCLUDED.has_bank_account,      financial_profiles.has_bank_account),
         has_jan_dhan_account  = COALESCE(EXCLUDED.has_jan_dhan_account,  financial_profiles.has_jan_dhan_account),
         has_aadhaar           = COALESCE(EXCLUDED.has_aadhaar,           financial_profiles.has_aadhaar),
         has_girl_child        = COALESCE(EXCLUDED.has_girl_child,        financial_profiles.has_girl_child),
         is_widow              = COALESCE(EXCLUDED.is_widow,              financial_profiles.is_widow),
         has_disability        = COALESCE(EXCLUDED.has_disability,        financial_profiles.has_disability),
         disability_type       = COALESCE(EXCLUDED.disability_type,       financial_profiles.disability_type),
         is_student            = COALESCE(EXCLUDED.is_student,            financial_profiles.is_student),
         education_level       = COALESCE(EXCLUDED.education_level,       financial_profiles.education_level),
         financial_goal        = COALESCE(EXCLUDED.financial_goal,        financial_profiles.financial_goal),
         goal_description      = COALESCE(EXCLUDED.goal_description,      financial_profiles.goal_description),
         goal_amount           = COALESCE(EXCLUDED.goal_amount,           financial_profiles.goal_amount),
         urgency_level         = COALESCE(EXCLUDED.urgency_level,         financial_profiles.urgency_level),
         completed_at          = NOW(),
         updated_at            = NOW()
       RETURNING *`,
      [
        uid,
        b.age || null,
        b.gender || null,
        b.marital_status || null,
        b.religion || null,
        b.caste_category || null,
        b.is_minority || false,
        b.occupation || null,
        b.sub_occupation || null,
        monthlyIncome,
        annualIncome,
        b.family_monthly_income || null,
        b.family_annual_income  || null,
        b.total_debts || 0,
        b.land_holding_acres || 0,
        b.num_dependents || 0,
        b.is_bpl || (['aay','phh'].includes(b.ration_card_type)),
        b.ration_card_type || null,
        b.ration_card_state_label || null,
        b.ration_card_member_count || null,
        b.has_bank_account ?? null,
        b.has_jan_dhan_account ?? null,
        b.has_aadhaar ?? null,
        b.has_kisan_credit_card || false,
        b.has_girl_child ?? null,
        b.num_girl_children || 0,
        b.is_widow ?? null,
        b.is_divorcee || false,
        (parseInt(b.age) >= 60) || false,
        b.education_level || null,
        b.is_student ?? (b.occupation === 'student'),
        b.student_class_level || null,
        b.has_disability ?? null,
        b.disability_type || null,
        b.disability_percentage || null,
        b.has_disability_certificate || false,
        b.financial_goal || null,
        b.goal_description || null,
        b.goal_amount || null,
        b.goal_timeframe_months || null,
        b.urgency_level || 3,
      ]
    );

    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

/* ── GET /api/users/:id/profile ──────────────────────────────────── */
router.get('/:id/profile', async (req, res, next) => {
  try {
    const r = await query(
      `SELECT fp.*, u.preferred_language, u.interaction_mode,
              u.state, u.district, u.village_town, u.residence_type
       FROM financial_profiles fp
       JOIN users u ON u.id = fp.user_id
       WHERE fp.user_id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found — complete onboarding first' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
