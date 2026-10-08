/**
 * ArthSathi — Health Check Routes
 *
 * GET /api/health      — liveness (always 200 if server is up)
 * GET /api/health/db   — database connectivity
 * GET /api/health/full — all services: DB + engine + last scrape
 */

const express = require('express');
const { healthCheck, query } = require('../db');
const { isEngineHealthy } = require('../services/engineService');

const router = express.Router();

// Liveness
router.get('/', (req, res) => {
  res.json({
    success:   true,
    status:    'ok',
    service:   'arthsathi-backend',
    timestamp: new Date().toISOString(),
    version:   '2.0.0',
  });
});

// DB readiness
router.get('/db', async (req, res, next) => {
  try {
    const ok = await healthCheck();
    res.json({
      success:   true,
      status:    ok ? 'ok' : 'degraded',
      database:  ok ? 'connected' : 'unreachable',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ success: false, database: 'error', error: err.message });
  }
});

// Full status — used by frontend to detect connectivity
router.get('/full', async (req, res) => {
  const results = {
    success:   true,
    timestamp: new Date().toISOString(),
    services:  {},
  };

  // DB
  try {
    await healthCheck();
    results.services.database = { status: 'ok' };

    // Scheme counts
    const counts = await query(
      `SELECT
        (SELECT COUNT(*) FROM schemes WHERE is_active = TRUE) AS schemes,
        (SELECT COUNT(*) FROM insurance_policies WHERE is_active = TRUE) AS insurance,
        (SELECT COUNT(*) FROM users) AS users`
    );
    results.services.database.counts = counts.rows[0];

    // Last scrape
    const lastScrape = await query(
      'SELECT started_at, rows_inserted, rows_updated, success FROM scraping_log ORDER BY started_at DESC LIMIT 1'
    );
    results.services.database.last_scrape = lastScrape.rows[0] || null;

  } catch (err) {
    results.services.database = { status: 'error', error: err.message };
  }

  // Python engine
  try {
    const engineOk = await isEngineHealthy();
    results.services.engine = { status: engineOk ? 'ok' : 'unavailable' };
  } catch {
    results.services.engine = { status: 'unavailable' };
  }

  const allOk = Object.values(results.services).every(s => s.status === 'ok');
  results.success = allOk;
  res.status(allOk ? 200 : 207).json(results);
});

module.exports = router;
