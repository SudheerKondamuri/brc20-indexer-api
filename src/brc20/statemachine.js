'use strict';

const Decimal = require('decimal.js');
const db = require('../db/database');
const logger = require('../utils/logger');

Decimal.set({ precision: 38, rounding: Decimal.ROUND_DOWN });

// ──────────────────────────────────────────────────────────────────────────────
// Validation helpers (pure functions — no DB access — used in unit tests too)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Validate a deploy operation fields (no DB check).
 * Returns { valid: true } or { valid: false, reason: string }.
 */
function validateDeployFields(op) {
  try {
    const max = new Decimal(op.max);
    if (max.lte(0)) return { valid: false, reason: 'max_supply must be > 0' };

    const lim = new Decimal(op.lim);
    if (lim.lte(0)) return { valid: false, reason: 'limit_per_mint must be > 0' };
    if (lim.gt(max)) return { valid: false, reason: 'limit_per_mint cannot exceed max_supply' };

    if (op.dec === undefined || op.dec === null) return { valid: false, reason: 'decimal_places required' };
    const dec = parseInt(op.dec, 10);
    if (isNaN(dec) || dec < 0 || dec > 18) return { valid: false, reason: 'decimal_places must be 0-18' };
  } catch {
    return { valid: false, reason: 'Invalid numeric values in deploy operation' };
  }
  return { valid: true };
}

/**
 * Validate a mint operation fields (no DB check).
 */
function validateMintFields(op) {
  try {
    const amt = new Decimal(op.amt);
    if (amt.lte(0)) return { valid: false, reason: 'mint amount must be > 0' };
  } catch {
    return { valid: false, reason: 'Invalid amount in mint operation' };
  }
  return { valid: true };
}

/**
 * Validate a transfer inscription fields (no DB check).
 */
function validateTransferFields(op) {
  try {
    const amt = new Decimal(op.amt);
    if (amt.lte(0)) return { valid: false, reason: 'transfer amount must be > 0' };
  } catch {
    return { valid: false, reason: 'Invalid amount in transfer operation' };
  }
  return { valid: true };
}

/**
 * Validate a mint against token constraints (pass token row from DB).
 */
function validateMintAgainstToken(op, token) {
  const amt = new Decimal(op.amt);
  const mintedSupply = new Decimal(token.minted_supply);
  const maxSupply = new Decimal(token.max_supply);
  const limitPerMint = token.limit_per_mint ? new Decimal(token.limit_per_mint) : null;

  if (mintedSupply.gte(maxSupply)) {
    return { valid: false, reason: 'max_supply already reached' };
  }

  if (limitPerMint && amt.gt(limitPerMint)) {
    return { valid: false, reason: `mint amount ${amt} exceeds limit_per_mint ${limitPerMint}` };
  }

  // Clamp to remaining supply
  const remaining = maxSupply.minus(mintedSupply);
  if (amt.gt(remaining)) {
    return { valid: false, reason: `mint amount ${amt} would exceed max_supply` };
  }

  return { valid: true };
}

/**
 * Validate a transfer inscription against the holder's available balance.
 */
function validateTransferAgainstBalance(op, availableBalance) {
  const amt = new Decimal(op.amt);
  const avail = new Decimal(availableBalance || 0);
  if (amt.gt(avail)) {
    return { valid: false, reason: `transfer amount ${amt} exceeds available balance ${avail}` };
  }
  return { valid: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// DB-aware state machine operations (run inside a transaction)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Process a DEPLOY inscription.
 */
async function processDeploy({ op, senderAddress, txId, blockHeight, blockTimestamp, client }) {
  const fieldCheck = validateDeployFields(op);
  if (!fieldCheck.valid) {
    logger.debug({ reason: fieldCheck.reason, txId }, 'Invalid deploy fields');
    return false;
  }

  const tick = op.tick.toLowerCase();

  // First-is-first rule: ignore subsequent deploys for same ticker
  const existing = await client.query('SELECT id FROM tokens WHERE LOWER(ticker) = $1', [tick]);
  if (existing.rows.length > 0) {
    logger.debug({ tick, txId }, 'Deploy ignored: ticker already deployed');
    return false;
  }

  const max = new Decimal(op.max);
  const lim = new Decimal(op.lim);
  const dec = parseInt(op.dec, 10);

  await client.query(
    `INSERT INTO tokens (ticker, max_supply, minted_supply, limit_per_mint, decimal_places,
       deployer_address, deploy_tx_id, deploy_block_height, deploy_timestamp)
     VALUES ($1, $2, 0, $3, $4, $5, $6, $7, $8)`,
    [tick, max.toFixed(), lim.toFixed(), dec, senderAddress, txId, blockHeight, blockTimestamp],
  );

  await client.query(
    `INSERT INTO events (event_type, ticker, amount, from_address, to_address, tx_id, block_height, block_timestamp, inscription_id)
     VALUES ('deploy', $1, $2, $3, NULL, $4, $5, $6, $7)`,
    [tick, max.toFixed(), senderAddress, txId, blockHeight, blockTimestamp, `${txId}i0`],
  );

  logger.info({ tick, maxSupply: max.toFixed(), txId, blockHeight }, 'BRC-20 deploy processed');
  return true;
}

/**
 * Process a MINT inscription.
 */
async function processMint({ op, senderAddress, txId, blockHeight, blockTimestamp, client }) {
  const fieldCheck = validateMintFields(op);
  if (!fieldCheck.valid) {
    logger.debug({ reason: fieldCheck.reason, txId }, 'Invalid mint fields');
    return false;
  }

  const tick = op.tick.toLowerCase();

  // Token must exist
  const tokenRes = await client.query('SELECT * FROM tokens WHERE LOWER(ticker) = $1', [tick]);
  if (tokenRes.rows.length === 0) {
    logger.debug({ tick, txId }, 'Mint ignored: token not deployed');
    return false;
  }
  const token = tokenRes.rows[0];

  const constraint = validateMintAgainstToken(op, token);
  if (!constraint.valid) {
    logger.debug({ reason: constraint.reason, tick, txId }, 'Mint ignored: constraint violation');
    return false;
  }

  const amt = new Decimal(op.amt);

  // Update total minted supply
  await client.query(
    'UPDATE tokens SET minted_supply = minted_supply + $1 WHERE LOWER(ticker) = $2',
    [amt.toFixed(), tick],
  );

  // Upsert minter balance
  await client.query(
    `INSERT INTO balances (ticker, address, available_balance, transferable_balance)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (ticker, address) DO UPDATE
       SET available_balance = balances.available_balance + $3,
           updated_at = NOW()`,
    [tick, senderAddress, amt.toFixed()],
  );

  // Record event
  await client.query(
    `INSERT INTO events (event_type, ticker, amount, from_address, to_address, tx_id, block_height, block_timestamp, inscription_id)
     VALUES ('mint', $1, $2, $3, $3, $4, $5, $6, $7)`,
    [tick, amt.toFixed(), senderAddress, txId, blockHeight, blockTimestamp, `${txId}i0`],
  );

  logger.info({ tick, amount: amt.toFixed(), address: senderAddress, txId, blockHeight }, 'BRC-20 mint processed');
  return true;
}

/**
 * Process a TRANSFER INSCRIPTION (Stage 1).
 * Moves tokens from available → transferable balance.
 */
async function processTransferInscribe({ op, senderAddress, txId, vout, blockHeight, blockTimestamp, client }) {
  const fieldCheck = validateTransferFields(op);
  if (!fieldCheck.valid) {
    logger.debug({ reason: fieldCheck.reason, txId }, 'Invalid transfer inscription fields');
    return false;
  }

  const tick = op.tick.toLowerCase();

  // Token must exist
  const tokenRes = await client.query('SELECT id FROM tokens WHERE LOWER(ticker) = $1', [tick]);
  if (tokenRes.rows.length === 0) {
    logger.debug({ tick, txId }, 'Transfer inscription ignored: token not deployed');
    return false;
  }

  // Sender must have enough available balance
  const balRes = await client.query(
    'SELECT available_balance FROM balances WHERE LOWER(ticker) = $1 AND address = $2',
    [tick, senderAddress],
  );

  const available = balRes.rows.length > 0 ? balRes.rows[0].available_balance : '0';
  const balanceCheck = validateTransferAgainstBalance(op, available);
  if (!balanceCheck.valid) {
    logger.debug({ reason: balanceCheck.reason, tick, txId }, 'Transfer inscription ignored: insufficient balance');
    return false;
  }

  const amt = new Decimal(op.amt);
  const inscriptionId = `${txId}i0`;

  // Move from available → transferable
  await client.query(
    `UPDATE balances
     SET available_balance = available_balance - $1,
         transferable_balance = transferable_balance + $1,
         updated_at = NOW()
     WHERE LOWER(ticker) = $2 AND address = $3`,
    [amt.toFixed(), tick, senderAddress],
  );

  // Record the pending transfer
  await client.query(
    `INSERT INTO pending_transfers
       (inscription_id, ticker, amount, owner_address, utxo_txid, utxo_vout, inscribe_block, inscribe_tx_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (inscription_id) DO NOTHING`,
    [inscriptionId, tick, amt.toFixed(), senderAddress, txId, vout, blockHeight, txId],
  );

  // Also index by UTXO
  await client.query(
    `INSERT INTO pending_transfers
       (inscription_id, ticker, amount, owner_address, utxo_txid, utxo_vout, inscribe_block, inscribe_tx_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (utxo_txid, utxo_vout) DO NOTHING`,
    [`${txId}i${vout}`, tick, amt.toFixed(), senderAddress, txId, vout, blockHeight, txId],
  );

  await client.query(
    `INSERT INTO events (event_type, ticker, amount, from_address, to_address, tx_id, block_height, block_timestamp, inscription_id)
     VALUES ('transfer_inscribe', $1, $2, $3, NULL, $4, $5, $6, $7)`,
    [tick, amt.toFixed(), senderAddress, txId, blockHeight, blockTimestamp, inscriptionId],
  );

  logger.info({ tick, amount: amt.toFixed(), address: senderAddress, txId, blockHeight }, 'BRC-20 transfer inscribed (Stage 1)');
  return true;
}

/**
 * Process a TRANSFER SPEND (Stage 2).
 * Called when a UTXO containing a transfer inscription is spent.
 * @param {Object} spendingTx - the decoded spending transaction
 * @param {string} recipientAddress - address of the first output
 */
async function processTransferSpend({ spendingTx, recipientAddress, blockHeight, blockTimestamp, client }) {
  if (!spendingTx.vin) return false;

  let processed = false;

  for (const input of spendingTx.vin) {
    const spentTxid = input.txid;
    const spentVout = input.vout;

    if (spentTxid === undefined || spentVout === undefined) continue;

    // Check if this input spends a pending transfer inscription
    const pendingRes = await client.query(
      'SELECT * FROM pending_transfers WHERE utxo_txid = $1 AND utxo_vout = $2 AND spent = FALSE',
      [spentTxid, spentVout],
    );

    if (pendingRes.rows.length === 0) continue;

    const pending = pendingRes.rows[0];
    const tick = pending.ticker.toLowerCase();
    const amt = new Decimal(pending.amount);
    const sender = pending.owner_address;

    // Mark pending transfer as spent
    await client.query(
      'UPDATE pending_transfers SET spent = TRUE, spend_tx_id = $1 WHERE id = $2',
      [spendingTx.txid, pending.id],
    );

    // Debit sender's transferable balance
    await client.query(
      `UPDATE balances
       SET transferable_balance = transferable_balance - $1,
           updated_at = NOW()
       WHERE LOWER(ticker) = $2 AND address = $3`,
      [amt.toFixed(), tick, sender],
    );

    // Credit recipient's available balance
    if (recipientAddress && recipientAddress !== sender) {
      await client.query(
        `INSERT INTO balances (ticker, address, available_balance, transferable_balance)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (ticker, address) DO UPDATE
           SET available_balance = balances.available_balance + $3,
               updated_at = NOW()`,
        [tick, recipientAddress, amt.toFixed()],
      );
    } else if (recipientAddress === sender) {
      // Sender transfers back to themselves — return to available
      await client.query(
        `UPDATE balances
         SET available_balance = available_balance + $1,
             updated_at = NOW()
         WHERE LOWER(ticker) = $2 AND address = $3`,
        [amt.toFixed(), tick, sender],
      );
    }

    await client.query(
      `INSERT INTO events (event_type, ticker, amount, from_address, to_address, tx_id, block_height, block_timestamp, inscription_id)
       VALUES ('transfer_spend', $1, $2, $3, $4, $5, $6, $7, $8)`,
      [tick, amt.toFixed(), sender, recipientAddress, spendingTx.txid, blockHeight, blockTimestamp, pending.inscription_id],
    );

    logger.info({
      tick,
      amount: amt.toFixed(),
      from: sender,
      to: recipientAddress,
      txId: spendingTx.txid,
      blockHeight,
    }, 'BRC-20 transfer spent (Stage 2)');

    processed = true;
  }

  return processed;
}

module.exports = {
  validateDeployFields,
  validateMintFields,
  validateTransferFields,
  validateMintAgainstToken,
  validateTransferAgainstBalance,
  processDeploy,
  processMint,
  processTransferInscribe,
  processTransferSpend,
};
