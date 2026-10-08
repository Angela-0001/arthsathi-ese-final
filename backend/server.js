/**
 * ArthSathi — HTTP Server Entry Point
 *
 * Starts the Express app and listens on the configured port.
 * Graceful shutdown on SIGINT/SIGTERM for clean process management.
 */

const app  = require('./src/app');
const { pool } = require('./src/db');

const PORT = parseInt(process.env.PORT || '3001', 10);

const server = app.listen(PORT, () => {
  console.log(`\n🌱 ArthSathi API running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`   DB check:     http://localhost:${PORT}/api/health/db\n`);
});

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
