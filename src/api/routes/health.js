'use strict';

const { query: dbQuery } = require('../../db/database');

/**
 * GET /health
 */
async function healthCheck(req, res) {
  const checks = { api: 'ok', db: 'unknown', bitcoin: 'unknown' };

  try {
    await dbQuery('SELECT 1');
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
  }

  try {
    const { rpcCall } = require('../../bitcoin/rpc');
    await rpcCall('getblockchaininfo');
    checks.bitcoin = 'ok';
  } catch {
    checks.bitcoin = 'error';
  }

  const statusCode = checks.db === 'ok' ? 200 : 503;
  return res.status(statusCode).json({ status: statusCode === 200 ? 'healthy' : 'degraded', checks });
}

/**
 * GET /api/v1/status
 */
async function getStatus(req, res) {
  try {
    const stateRes = await dbQuery("SELECT value FROM indexer_state WHERE key = 'last_indexed_height'");
    const lastIndexedHeight = stateRes.rows[0] ? parseInt(stateRes.rows[0].value, 10) : -1;

    const tokenCountRes = await dbQuery('SELECT COUNT(*) AS count FROM tokens');
    const eventCountRes = await dbQuery('SELECT COUNT(*) AS count FROM events');

    let nodeHeight = null;
    try {
      const { getBlockCount } = require('../../bitcoin/rpc');
      nodeHeight = await getBlockCount();
    } catch { /* ignore */ }

    return res.json({
      status: 'running',
      last_indexed_height: lastIndexedHeight,
      node_height: nodeHeight,
      token_count: parseInt(tokenCountRes.rows[0].count, 10),
      event_count: parseInt(eventCountRes.rows[0].count, 10),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get indexer status' });
  }
}

module.exports = { healthCheck, getStatus };
