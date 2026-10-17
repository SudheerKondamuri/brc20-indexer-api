'use strict';

const { query } = require('../../db/database');

/**
 * GET /api/v1/brc20/token?ticker=XXXX
 */
async function getToken(req, res) {
  const ticker = (req.query.ticker || '').toLowerCase().trim();

  const result = await query(
    `SELECT ticker, max_supply, minted_supply, limit_per_mint,
            decimal_places, deploy_timestamp
     FROM tokens
     WHERE LOWER(ticker) = $1`,
    [ticker],
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: `Token '${req.query.ticker}' not found` });
  }

  const t = result.rows[0];
  return res.json({
    ticker: t.ticker,
    max_supply: t.max_supply.toString(),
    minted_supply: t.minted_supply.toString(),
    limit_per_mint: t.limit_per_mint ? t.limit_per_mint.toString() : null,
    decimal_places: t.decimal_places,
    deploy_timestamp: t.deploy_timestamp,
  });
}

/**
 * GET /api/v1/brc20/balance?ticker=XXXX&address=YYYY
 */
async function getBalance(req, res) {
  const ticker = (req.query.ticker || '').toLowerCase().trim();
  const address = (req.query.address || '').trim();

  // Verify token exists
  const tokenRes = await query(
    'SELECT id FROM tokens WHERE LOWER(ticker) = $1',
    [ticker],
  );
  if (tokenRes.rows.length === 0) {
    return res.status(404).json({ error: `Token '${req.query.ticker}' not found` });
  }

  const result = await query(
    `SELECT available_balance, transferable_balance, total_balance
     FROM balances
     WHERE LOWER(ticker) = $1 AND address = $2`,
    [ticker, address],
  );

  if (result.rows.length === 0) {
    return res.json({
      ticker,
      address,
      balance: '0',
      available_balance: '0',
      transferable_balance: '0',
    });
  }

  const b = result.rows[0];
  return res.json({
    ticker,
    address,
    balance: b.total_balance.toString(),
    available_balance: b.available_balance.toString(),
    transferable_balance: b.transferable_balance.toString(),
  });
}

/**
 * GET /api/v1/brc20/holders?ticker=XXXX&limit=20&offset=0
 */
async function getHolders(req, res) {
  const ticker = (req.query.ticker || '').toLowerCase().trim();
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);

  if (isNaN(limit) || limit < 1) {
    return res.status(400).json({ error: 'limit must be a positive integer (max 100)' });
  }
  if (isNaN(offset) || offset < 0) {
    return res.status(400).json({ error: 'offset must be a non-negative integer' });
  }

  // Verify token exists
  const tokenRes = await query(
    'SELECT id FROM tokens WHERE LOWER(ticker) = $1',
    [ticker],
  );
  if (tokenRes.rows.length === 0) {
    return res.status(404).json({ error: `Token '${req.query.ticker}' not found` });
  }

  const [holdersRes, countRes] = await Promise.all([
    query(
      `SELECT address, total_balance AS balance
       FROM balances
       WHERE LOWER(ticker) = $1 AND total_balance > 0
       ORDER BY total_balance DESC
       LIMIT $2 OFFSET $3`,
      [ticker, limit, offset],
    ),
    query(
      'SELECT COUNT(*) AS total FROM balances WHERE LOWER(ticker) = $1 AND total_balance > 0',
      [ticker],
    ),
  ]);

  return res.json({
    holders: holdersRes.rows.map((r) => ({
      address: r.address,
      balance: r.balance.toString(),
    })),
    total: parseInt(countRes.rows[0].total, 10),
  });
}

/**
 * GET /api/v1/brc20/events?ticker=XXXX[&address=YYYY][&limit=20][&offset=0]
 */
async function getEvents(req, res) {
  const ticker = (req.query.ticker || '').toLowerCase().trim();
  const address = (req.query.address || '').trim() || null;
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const offset = parseInt(req.query.offset || '0', 10);

  const tokenRes = await query(
    'SELECT id FROM tokens WHERE LOWER(ticker) = $1',
    [ticker],
  );
  if (tokenRes.rows.length === 0) {
    return res.status(404).json({ error: `Token '${req.query.ticker}' not found` });
  }

  let whereClause = 'WHERE LOWER(ticker) = $1';
  const params = [ticker];

  if (address) {
    params.push(address);
    whereClause += ` AND (from_address = $${params.length} OR to_address = $${params.length})`;
  }

  params.push(limit, offset);

  const eventsRes = await query(
    `SELECT event_type, ticker, amount, from_address, to_address, tx_id,
            block_height, block_timestamp, inscription_id, created_at
     FROM events
     ${whereClause}
     ORDER BY block_height DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const countParams = address ? [ticker, address] : [ticker];
  const countWhere = address ? 'WHERE LOWER(ticker) = $1 AND (from_address = $2 OR to_address = $2)' : 'WHERE LOWER(ticker) = $1';

  const countRes = await query(
    `SELECT COUNT(*) AS total FROM events ${countWhere}`,
    countParams,
  );

  return res.json({
    events: eventsRes.rows,
    total: parseInt(countRes.rows[0].total, 10),
  });
}

module.exports = { getToken, getBalance, getHolders, getEvents };
