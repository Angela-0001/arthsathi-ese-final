/**
 * ArthSathi — Engine Service (Node.js proxy to Python FastAPI)
 *
 * Calls the Python recommendation engine at http://127.0.0.1:8001.
 * Falls back to cached results from DB if engine is unreachable.
 * This design keeps the recommendation logic entirely in Python (single
 * source of truth) while Express handles auth, logging, and API routing.
 */

const http = require('http');

const ENGINE_BASE = process.env.ENGINE_URL || 'http://127.0.0.1:8001';
const ENGINE_TIMEOUT = 30000; // 30s timeout

/**
 * POST to the Python engine.
 * @param {string} path  — e.g. '/recommend', '/event', '/retrain'
 * @param {object} body
 * @returns {Promise<object>}
 */
function enginePost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(ENGINE_BASE + path);

    const options = {
      hostname: url.hostname,
      port:     url.port || 8001,
      path:     url.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: ENGINE_TIMEOUT,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Engine response parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Engine request timed out'));
    });
    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * GET from the Python engine.
 */
function engineGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(ENGINE_BASE + path);
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Engine parse error')); }
      });
    }).on('error', reject);
  });
}

/**
 * Get personalised recommendations for a user.
 * Returns { schemes, insurance, session_id, weights_used, profile_summary }
 */
async function getRecommendations(userId, options = {}) {
  const { limit = 10, itemType = 'both', sessionId } = options;
  return enginePost('/recommend', {
    user_id:  userId,
    limit,
    item_type: itemType,
    session_id: sessionId,
  });
}

/**
 * Log an interaction event (click, apply, dismiss, etc.)
 */
async function logEvent(eventData) {
  return enginePost('/event', eventData);
}

/**
 * Check if the engine is reachable.
 */
async function isEngineHealthy() {
  try {
    const h = await engineGet('/health');
    return h.status === 'ok';
  } catch {
    return false;
  }
}

module.exports = { getRecommendations, logEvent, isEngineHealthy, enginePost, engineGet };
