'use strict';

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { healthCheck, getStatus } = require('./routes/health');
const { getToken, getBalance, getHolders, getEvents } = require('./routes/brc20');
const { validateQuery, asyncHandler, errorHandler, notFoundHandler } = require('./middleware/validators');
const logger = require('../utils/logger');

/**
 * Build and return the Express application.
 */
function createApp() {
  const app = express();

  // ── Security & Utility Middleware ──────────────────────────────────────────
  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // HTTP request logging (skip in test mode)
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('combined', {
      stream: { write: (msg) => logger.info(msg.trim()) },
    }));
  }

  // CORS headers
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── Health & Status Routes ─────────────────────────────────────────────────
  app.get('/health', asyncHandler(healthCheck));
  app.get('/api/v1/status', asyncHandler(getStatus));

  // ── BRC-20 API Routes ──────────────────────────────────────────────────────
  const brc20Router = express.Router();

  /**
   * GET /api/v1/brc20/token?ticker=XXXX
   */
  brc20Router.get(
    '/token',
    validateQuery(['ticker']),
    asyncHandler(getToken),
  );

  /**
   * GET /api/v1/brc20/balance?ticker=XXXX&address=YYYY
   */
  brc20Router.get(
    '/balance',
    validateQuery(['ticker', 'address']),
    asyncHandler(getBalance),
  );

  /**
   * GET /api/v1/brc20/holders?ticker=XXXX[&limit=20][&offset=0]
   */
  brc20Router.get(
    '/holders',
    validateQuery(['ticker']),
    asyncHandler(getHolders),
  );

  /**
   * GET /api/v1/brc20/events?ticker=XXXX[&address=YYYY][&limit=20][&offset=0]
   */
  brc20Router.get(
    '/events',
    validateQuery(['ticker']),
    asyncHandler(getEvents),
  );

  app.use('/api/v1/brc20', brc20Router);

  // ── Error Handling ─────────────────────────────────────────────────────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
