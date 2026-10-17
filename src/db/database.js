'use strict';

const { Pool } = require('pg');
const config = require('../utils/config');
const logger = require('../utils/logger');

let pool;

/**
 * Returns (and creates if necessary) the shared pg Pool.
 */
function getPool() {
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      max: config.db.max,
      idleTimeoutMillis: config.db.idleTimeoutMillis,
      connectionTimeoutMillis: config.db.connectionTimeoutMillis,
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected PostgreSQL pool error');
    });

    pool.on('connect', () => {
      logger.debug('New PostgreSQL connection established');
    });
  }
  return pool;
}

/**
 * Run a query. Returns pg QueryResult.
 */
async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  logger.debug({ query: text, durationMs: Date.now() - start, rows: result.rowCount }, 'DB query executed');
  return result;
}

/**
 * Get a client for transactional use. Remember to client.release() after use.
 */
async function getClient() {
  return getPool().connect();
}

/**
 * Run multiple operations inside a transaction.
 * @param {Function} fn - async function receiving a pg client
 */
async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get the last indexed block height from DB.
 */
async function getLastIndexedHeight() {
  const res = await query(
    "SELECT value FROM indexer_state WHERE key = 'last_indexed_height'",
  );
  if (res.rows.length === 0) return -1;
  return parseInt(res.rows[0].value, 10);
}

/**
 * Persist the last successfully indexed block height.
 */
async function setLastIndexedHeight(height, client) {
  const q = client || { query: (t, p) => query(t, p) };
  await q.query(
    "UPDATE indexer_state SET value = $1, updated_at = NOW() WHERE key = 'last_indexed_height'",
    [height.toString()],
  );
}

/**
 * Close the pool (used in tests / graceful shutdown).
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  query,
  getClient,
  withTransaction,
  getLastIndexedHeight,
  setLastIndexedHeight,
  closePool,
};
