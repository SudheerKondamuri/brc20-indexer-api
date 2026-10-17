'use strict';

const axios = require('axios');
const config = require('../utils/config');
const logger = require('../utils/logger');

const RPC_URL = `http://${config.bitcoin.host}:${config.bitcoin.port}`;
const AUTH = {
  username: config.bitcoin.user,
  password: config.bitcoin.password,
};

let reqId = 0;

/**
 * Make a Bitcoin Core JSON-RPC call.
 * @param {string} method
 * @param {Array} params
 * @returns {Promise<any>} RPC result value
 */
async function rpcCall(method, params = []) {
  reqId += 1;
  const payload = {
    jsonrpc: '1.0',
    id: reqId,
    method,
    params,
  };

  try {
    const response = await axios.post(RPC_URL, payload, {
      auth: AUTH,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    if (response.data.error) {
      throw new Error(`Bitcoin RPC error [${method}]: ${JSON.stringify(response.data.error)}`);
    }

    return response.data.result;
  } catch (err) {
    if (err.response) {
      const rpcErr = err.response.data?.error;
      throw new Error(`Bitcoin RPC HTTP error [${method}] ${err.response.status}: ${JSON.stringify(rpcErr || err.response.data)}`);
    }
    throw err;
  }
}

/**
 * Get current blockchain info including block height.
 */
async function getBlockchainInfo() {
  return rpcCall('getblockchaininfo');
}

/**
 * Get block hash for a given height.
 */
async function getBlockHash(height) {
  return rpcCall('getblockhash', [height]);
}

/**
 * Get full block data with verbosity=2 (transactions decoded).
 */
async function getBlock(hashOrHeight) {
  let hash = hashOrHeight;
  if (typeof hashOrHeight === 'number') {
    hash = await getBlockHash(hashOrHeight);
  }
  return rpcCall('getblock', [hash, 2]);
}

/**
 * Get a raw transaction decoded.
 */
async function getRawTransaction(txid, verbose = true) {
  return rpcCall('getrawtransaction', [txid, verbose ? 1 : 0]);
}

/**
 * Get block count (tip height).
 */
async function getBlockCount() {
  return rpcCall('getblockcount');
}

/**
 * Get best block hash.
 */
async function getBestBlockHash() {
  return rpcCall('getbestblockhash');
}

module.exports = {
  rpcCall,
  getBlockchainInfo,
  getBlockHash,
  getBlock,
  getRawTransaction,
  getBlockCount,
  getBestBlockHash,
};
