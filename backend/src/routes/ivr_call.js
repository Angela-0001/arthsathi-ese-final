/**
 * ArthSathi — Outbound IVR Call Initiator
 *
 * POST /api/ivr/call  — Makes Twilio call a phone number and connects
 *                       it to the ArthSathi IVR flow.
 *
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER in .env
 * Also requires: BASE_URL to be set to your public ngrok/server URL.
 */

const express = require('express');
const https   = require('https');
const router  = express.Router();

// POST /api/ivr/call  { to: "+918454053146", lang: "hi" }
router.post('/call', async (req, res) => {
  const { to, lang = 'hi' } = req.body;

  const sid    = process.env.TWILIO_ACCOUNT_SID;
  const token  = process.env.TWILIO_AUTH_TOKEN;
  const from   = process.env.TWILIO_PHONE_NUMBER;
  const base   = process.env.BASE_URL || process.env.NGROK_URL;

  if (!sid || !token || !from) {
    return res.status(503).json({
      success: false,
      error: 'Twilio credentials not configured in .env',
      required: ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_PHONE_NUMBER'],
    });
  }

  if (!base) {
    return res.status(503).json({
      success: false,
      error: 'BASE_URL not set — Twilio needs a public URL to reach your server. Set BASE_URL=https://your-ngrok-url in .env',
    });
  }

  if (!to) {
    return res.status(400).json({ success: false, error: 'to (phone number) is required' });
  }

  // Build the TwiML webhook URL pointing to our IVR entry point
  const webhookUrl = `${base}/api/ivr/voice`;

  // Call Twilio REST API to initiate the call
  const params = new URLSearchParams({
    To:   to,
    From: from,
    Url:  webhookUrl,
    Method: 'POST',
  });

  const options = {
    hostname: 'api.twilio.com',
    path:     `/2010-04-01/Accounts/${sid}/Calls.json`,
    method:   'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
    },
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', c => data += c);
    apiRes.on('end', () => {
      const parsed = JSON.parse(data);
      if (apiRes.statusCode === 201) {
        res.json({
          success:  true,
          call_sid: parsed.sid,
          status:   parsed.status,
          to:       parsed.to,
          from:     parsed.from,
          message:  `Calling ${to}... Answer your phone!`,
        });
      } else {
        res.status(400).json({ success: false, error: parsed.message || data });
      }
    });
  });

  apiReq.on('error', e => res.status(500).json({ success: false, error: e.message }));
  apiReq.write(params.toString());
  apiReq.end();
});

module.exports = router;
