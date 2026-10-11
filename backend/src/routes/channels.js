'use strict';

const express = require('express');
const router = express.Router();

/**
 * GET /api/channels
 * Returns connection info for all supported channels.
 */
router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      ivr: {
        number: '02248963501',
        description: 'Call and get scheme info in Hindi, English or Marathi',
        languages: ['hi', 'en', 'mr'],
      },
      whatsapp: {
        number: '+14155238886',
        link: 'https://wa.me/14155238886',
        description: 'Chat on WhatsApp for scheme recommendations',
      },
      telegram: {
        bot: '@arthsathi_demo_bot',
        link: 'https://t.me/arthsathi_demo_bot',
        description: 'Chat on Telegram for scheme info',
      },
    },
  });
});

module.exports = router;
