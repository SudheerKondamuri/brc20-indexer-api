'use strict';

const logger = require('../../utils/logger');

/**
 * Validate required query parameters.
 * Usage: validateQuery(['ticker', 'address'])
 */
function validateQuery(requiredParams) {
  return (req, res, next) => {
    const missing = requiredParams.filter((p) => !req.query[p] || !req.query[p].toString().trim());
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required query parameter(s): ${missing.join(', ')}`,
      });
    }
    next();
  };
}

/**
 * Async route wrapper — catches errors and passes to errorHandler.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error handler middleware.
 */
function errorHandler(err, req, res, next) {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'Unhandled API error');
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
}

/**
 * 404 handler for unknown routes.
 */
function notFoundHandler(req, res) {
  return res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

module.exports = { validateQuery, asyncHandler, errorHandler, notFoundHandler };
