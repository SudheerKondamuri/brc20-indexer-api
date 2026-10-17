'use strict';

/**
 * config.js
 * Centralised configuration loaded from environment variables.
 */
module.exports = {
  bitcoin: {
    host: process.env.BITCOIN_RPC_HOST || 'localhost',
    port: parseInt(process.env.BITCOIN_RPC_PORT || '18443', 10),
    user: process.env.BITCOIN_RPC_USER || 'bitcoinrpc',
    password: process.env.BITCOIN_RPC_PASSWORD || 'bitcoinrpc_password',
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'brc20user',
    password: process.env.DB_PASSWORD || 'brc20password',
    database: process.env.DB_NAME || 'brc20indexer',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000', 10),
    host: process.env.API_HOST || '0.0.0.0',
  },
  indexer: {
    startHeight: parseInt(process.env.INDEXER_START_HEIGHT || '0', 10),
    pollIntervalMs: parseInt(process.env.INDEXER_POLL_INTERVAL_MS || '2000', 10),
  },
};
