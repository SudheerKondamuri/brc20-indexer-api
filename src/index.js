'use strict';

const { createApp } = require('./api/app');
const { startIndexer } = require('./indexer/indexer');
const config = require('./utils/config');
const logger = require('./utils/logger');
const db = require('./db/database');

async function main() {
  logger.info({ version: process.env.npm_package_version || '1.0.0' }, 'BRC-20 Indexer & API starting');

  // ── Verify DB connectivity ────────────────────────────────────────────────
  let dbReady = false;
  while (!dbReady) {
    try {
      await db.query('SELECT 1');
      logger.info('PostgreSQL connection established');
      dbReady = true;
    } catch (err) {
      logger.warn({ err: err.message }, 'Waiting for PostgreSQL...');
      await sleep(3000);
    }
  }

  // ── Start HTTP API server ─────────────────────────────────────────────────
  const app = createApp();
  const server = app.listen(config.api.port, config.api.host, () => {
    logger.info({ host: config.api.host, port: config.api.port }, 'HTTP API server listening');
  });

  server.on('error', (err) => {
    logger.error({ err }, 'HTTP server error');
    process.exit(1);
  });

  // ── Start Indexer (non-blocking) ──────────────────────────────────────────
  startIndexer().catch((err) => {
    logger.error({ err }, 'Indexer fatal error');
    process.exit(1);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal) => {
    logger.info({ signal }, 'Shutting down...');
    server.close(async () => {
      await db.closePool();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
    process.exit(1);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
