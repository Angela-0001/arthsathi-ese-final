/**
 * ArthSathi IVR Simulator
 * Run: node src/utils/ivr_simulator.js
 * Simulates a full Twilio call without a real phone number.
 */
'use strict';
const http = require('http');
const BASE = `http://localhost:${process.env.PORT || 3001}`;

function post(path, params) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    const req  = http.request(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function say(twiml) {
  return [...twiml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map(m => m[1].trim()).join(' ');
}

async function run() {
  console.log('\n=== ArthSathi IVR Simulator ===');
  console.log('Profile: Hindi | Male | SC | Farmer | Maharashtra | Rs.5000/mo\n');

  let twiml;

  twiml = await post('/api/ivr/voice', { From: '+919800000001', CallSid: 'SIMTEST001' });
  console.log('[Incoming call] IVR says:', say(twiml).slice(0, 120));

  twiml = await post('/api/ivr/language', { From: '+919800000001', CallSid: 'SIMTEST001', Digits: '1' });
  console.log('\n[Key 1 = Hindi] IVR says:', say(twiml).slice(0, 120));

  const qs = '?lang=hi&caller=%2B919800000001';

  twiml = await post('/api/ivr/age'        + qs,                    { Digits: '35' });
  console.log('\n[Age 35] IVR asks:', say(twiml).slice(0, 100));

  twiml = await post('/api/ivr/gender'     + qs + '&age=35',        { Digits: '1' });
  console.log('\n[Key 1 = Male] IVR asks:', say(twiml).slice(0, 100));

  twiml = await post('/api/ivr/caste'      + qs + '&age=35&gender=male',          { Digits: '3' });
  console.log('\n[Key 3 = SC] IVR asks:', say(twiml).slice(0, 100));

  twiml = await post('/api/ivr/occupation' + qs + '&age=35&gender=male&caste=sc', { Digits: '1' });
  console.log('\n[Key 1 = Farmer] IVR asks:', say(twiml).slice(0, 100));

  twiml = await post('/api/ivr/income'     + qs + '&age=35&gender=male&caste=sc&occ=farmer', { Digits: '5000' });
  console.log('\n[Income Rs.5000] IVR asks:', say(twiml).slice(0, 100));

  // Bank → generates recommendations
  twiml = await post('/api/ivr/bank' + qs + '&age=35&gender=male&caste=sc&occ=farmer&income=5000', { Digits: '1' });
  const result = say(twiml);
  console.log('\n[Key 1 = Has bank account]\n[IVR reads results]:');
  result.split('.').filter(s => s.trim().length > 3).slice(0, 8)
        .forEach(s => console.log('  -', s.trim().slice(0, 90)));

  console.log('\n=== Simulation complete ===');
  console.log('\nIVR One Manual Step Required:');
  console.log('  1. Create Twilio account: https://twilio.com');
  console.log('  2. Get a phone number with Voice capability');
  console.log('  3. Set webhook: POST https://<your-server>/api/ivr/voice');
  console.log('  4. Add to backend/.env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER');
}

run().catch(e => { console.error('Simulator error:', e.message); process.exit(1); });
