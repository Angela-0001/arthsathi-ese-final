'use strict';
/**
 * ArthSathi — Auth / Channel Linking Routes
 *
 * POST /api/auth/link-telegram  — link Telegram account to web profile
 * POST /api/auth/link-whatsapp  — link WhatsApp number to web profile
 */

const express = require('express');
const { query } = require('../db');
const router  = express.Router();

// ── POST /api/auth/link-telegram ──────────────────────────────────────────
// Body: { phone, telegram_id }
router.post('/link-telegram', async (req, res, next) => {
  try {
    const { phone, telegram_id } = req.body;
    if (!phone || !telegram_id) {
      return res.status(400).json({ success: false, detail: 'phone and telegram_id required' });
    }

    const clean = phone.toString().replace(/\D/g, '').slice(-10);

    // Find user by phone
    const found = await query('SELECT * FROM users WHERE phone_number = $1', [clean]);
    if (found.rows.length === 0) {
      return res.status(404).json({
        success: false,
        detail: `No account found for ${clean}. Register at the web app first.`
      });
    }

    const user = found.rows[0];

    // Link telegram_id
    await query(
      'UPDATE users SET telegram_id = $1, updated_at = NOW() WHERE id = $2',
      [String(telegram_id), user.id]
    );

    res.json({
      success: true,
      name: user.full_name || null,
      message: `Account linked! Welcome ${user.full_name || 'to ArthSathi'}.`,
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/link-whatsapp ──────────────────────────────────────────
// Body: { phone, whatsapp_number }
router.post('/link-whatsapp', async (req, res, next) => {
  try {
    const { phone, whatsapp_number } = req.body;
    if (!phone || !whatsapp_number) {
      return res.status(400).json({ success: false, detail: 'phone and whatsapp_number required' });
    }

    const clean = phone.toString().replace(/\D/g, '').slice(-10);

    const found = await query('SELECT * FROM users WHERE phone_number = $1', [clean]);
    if (found.rows.length === 0) {
      return res.status(404).json({
        success: false,
        detail: `No account found for ${clean}. Register at the web app first.`
      });
    }

    const user = found.rows[0];

    await query(
      'UPDATE users SET whatsapp_number = $1, updated_at = NOW() WHERE id = $2',
      [String(whatsapp_number), user.id]
    );

    res.json({
      success: true,
      name: user.full_name || null,
      message: `WhatsApp linked! Welcome ${user.full_name || 'to ArthSathi'}.`,
    });
  } catch (err) { next(err); }
});

module.exports = router;
