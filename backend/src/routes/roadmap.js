'use strict';
const express = require('express');
const { generate } = require('../services/roadmapService');
const router = express.Router();

// GET /api/roadmap/:userId
router.get('/:userId', async (req, res, next) => {
  try {
    const roadmap = await generate(req.params.userId);
    res.json({ success: true, data: roadmap });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ success: false, error: { code: err.code, message: err.message } });
    }
    if (err.code === 'PROFILE_NOT_FOUND') {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }
    next(err);
  }
});

module.exports = router;