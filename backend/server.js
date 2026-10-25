/**
 * ArthSathi — HTTP + WebSocket Server Entry Point
 */

require('dotenv').config();
const app  = require('./src/app');
const { pool } = require('./src/db');
const { WebSocketServer } = require('ws');
const { handleVoicebotConnection } = require('./src/services/voicebotService');

const PORT = parseInt(process.env.PORT || '3001', 10);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌱 ArthSathi API running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   Voicebot WS:  ws://localhost:${PORT}/voicebot\n`);
});

// ── WebSocket server for Exotel voicebot ────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/voicebot' });
wss.on('connection', (ws, req) => {
  console.log('[VoiceBot] New connection');
  handleVoicebotConnection(ws, req);
});
console.log('[VoiceBot] WebSocket server ready at /voicebot');

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
const shutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
  server.close(async () => {
    try {
      await pool.end();
      console.log('[Server] Database pool closed. Bye!');
      process.exit(0);
    } catch (err) {
      console.error('[Server] Error during shutdown:', err.message);
      process.exit(1);
    }
  });
};

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
