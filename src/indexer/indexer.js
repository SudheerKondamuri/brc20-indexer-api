'use strict';

const rpc = require('../bitcoin/rpc');
const { extractInscriptionsFromTx, parseBrc20Inscription } = require('../bitcoin/inscription');
const {
  processDeploy,
  processMint,
  processTransferInscribe,
  processTransferSpend,
} = require('../brc20/statemachine');
const db = require('../db/database');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * Extract the address from the first non-OP_RETURN output of a transaction.
 */
function getFirstOutputAddress(tx) {
  if (!tx.vout) return null;
  for (const out of tx.vout) {
    const addr = out.scriptPubKey?.address;
    if (addr) return addr;
    // Multisig / P2PK may have addresses array
    if (out.scriptPubKey?.addresses && out.scriptPubKey.addresses.length > 0) {
      return out.scriptPubKey.addresses[0];
    }
  }
  return null;
}

/**
 * Attempt to resolve the sender address of an input.
 * For taproot inscription transactions, the sender is usually in the
 * second witness item's script (the key-spend path gives the script pubkey).
 */
async function resolveSenderAddress(input, tx) {
  // If the input has a scriptSig address (legacy / P2SH)
  if (input.scriptSig?.address) return input.scriptSig.address;

  // For segwit/taproot, look at the prevout's scriptPubKey address
  if (input.prevout?.scriptPubKey?.address) return input.prevout.scriptPubKey.address;
  if (input.prevout?.scriptPubKey?.addresses?.[0]) return input.prevout.scriptPubKey.addresses[0];

  // Try to fetch from RPC
  if (input.txid && input.vout !== undefined) {
    try {
      const prevTx = await rpc.getRawTransaction(input.txid, true);
      const prevOut = prevTx?.vout?.[input.vout];
      if (prevOut?.scriptPubKey?.address) return prevOut.scriptPubKey.address;
      if (prevOut?.scriptPubKey?.addresses?.[0]) return prevOut.scriptPubKey.addresses[0];
    } catch (err) {
      logger.debug({ err: err.message, txid: input.txid }, 'Could not fetch prevout tx for sender resolution');
    }
  }

  return null;
}

/**
 * Process a single block: find inscriptions and apply BRC-20 state changes.
 */
async function processBlock(block) {
  const blockHeight = block.height;
  const blockTimestamp = new Date(block.time * 1000).toISOString();

  logger.debug({ height: blockHeight, txCount: block.tx.length }, 'Processing block');

  await db.withTransaction(async (client) => {
    for (const tx of block.tx) {
      // ── Stage 2: Check if any inputs spend a pending transfer inscription ──
      await processTransferSpend({
        spendingTx: tx,
        recipientAddress: getFirstOutputAddress(tx),
        blockHeight,
        blockTimestamp,
        client,
      });

      // ── Stage 1: Check for new inscriptions in this tx ──
      const inscriptions = extractInscriptionsFromTx(tx);

      for (const inscription of inscriptions) {
        const brc20Op = parseBrc20Inscription(inscription.body, inscription.contentType);
        if (!brc20Op) continue;

        // Resolve the sender address (owner of the inscription input)
        const input = tx.vin[inscription.inputIndex];
        let senderAddress = await resolveSenderAddress(input, tx);

        // Fallback: use first output address for coinbase-like scenarios
        if (!senderAddress) {
          senderAddress = getFirstOutputAddress(tx);
        }

        logger.debug({
          op: brc20Op.op,
          tick: brc20Op.tick,
          txId: tx.txid,
          sender: senderAddress,
          blockHeight,
        }, 'Found BRC-20 inscription');

        switch (brc20Op.op) {
          case 'deploy':
            await processDeploy({
              op: brc20Op,
              senderAddress,
              txId: tx.txid,
              blockHeight,
              blockTimestamp,
              client,
            });
            break;

          case 'mint':
            await processMint({
              op: brc20Op,
              senderAddress,
              txId: tx.txid,
              blockHeight,
              blockTimestamp,
              client,
            });
            break;

          case 'transfer':
            await processTransferInscribe({
              op: brc20Op,
              senderAddress,
              txId: tx.txid,
              vout: 0, // inscription output is vout 0 in standard ordinal txs
              blockHeight,
              blockTimestamp,
              client,
            });
            break;

          default:
            break;
        }
      }
    }

    // Update last indexed block height
    await db.setLastIndexedHeight(blockHeight, client);
  });

  logger.info({ height: blockHeight }, 'Block processed');
}

/**
 * Main indexer loop. Polls Bitcoin Core for new blocks and processes them.
 */
async function startIndexer() {
  logger.info('BRC-20 Indexer starting...');

  // Wait for RPC to be available
  let rpcReady = false;
  while (!rpcReady) {
    try {
      await rpc.getBlockchainInfo();
      rpcReady = true;
      logger.info('Connected to Bitcoin Core RPC');
    } catch (err) {
      logger.warn({ err: err.message }, 'Waiting for Bitcoin Core RPC...');
      await sleep(3000);
    }
  }

  // Determine start height
  let lastHeight = await db.getLastIndexedHeight();
  if (lastHeight === -1) {
    lastHeight = config.indexer.startHeight - 1;
  }

  logger.info({ resumingFrom: lastHeight + 1 }, 'Indexer resuming');

  // Polling loop
  while (true) {
    try {
      const tipHeight = await rpc.getBlockCount();

      if (tipHeight > lastHeight) {
        const nextHeight = lastHeight + 1;
        logger.debug({ nextHeight, tipHeight }, 'Fetching block');
        const block = await rpc.getBlock(nextHeight);
        await processBlock(block);
        lastHeight = nextHeight;
      } else {
        // No new blocks — wait
        await sleep(config.indexer.pollIntervalMs);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'Indexer error — will retry');
      await sleep(config.indexer.pollIntervalMs);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { startIndexer, processBlock, getFirstOutputAddress };
