/**
 * ArthSathi — PostgreSQL connection pool
 *
 * Uses the `pg` library's Pool for efficient connection management.
 * All backend services import this module to access the database.
 * Configuration is read from environment variables so no credentials
 * are ever hardcoded.
 */

const { Pool } = require('pg');

// Create a connection pool. pg.Pool handles reconnects automatically.
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME     || 'arthsathi',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',

  // Pool configuration — tuned for a single-server deployment
  max:              10,   // maximum concurrent connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Log a warning on unexpected pool errors (connection drops, etc.)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Runs a single query against the pool.
 * @param {string} text  — SQL string with $1, $2, ... placeholders
 * @param {Array}  params — parameter values (optional)
 * @returns {Promise<pg.QueryResult>}
 */
const query = (text, params) => pool.query(text, params);

/**
 * Checks that the database is reachable.
 * Used by the health-check endpoint.
 * @returns {Promise<boolean>}
 */
const healthCheck = async () => {
  const result = await pool.query('SELECT 1');
  return result.rowCount === 1;
};

module.exports = { pool, query, healthCheck };
