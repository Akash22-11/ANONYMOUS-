// src/middleware/logger.js — HTTP request/response logging middleware

const { logger } = require('../utils/logger');

/**
 * Logs every HTTP request with method, url, status, duration, and user id.
 * Excludes health check endpoints from noise.
 */
function httpLogger(req, res, next) {
  const SKIP_PATHS = ['/health', '/favicon.ico'];
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Log after response finishes to capture status code
  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId   = req.user?.id ?? 'anonymous';
    const status   = res.statusCode;
    const level    = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'http';

    logger[level](`${method} ${originalUrl} ${status} ${duration}ms — user:${userId} ip:${ip}`);
  });

  return next();
}

module.exports = { httpLogger };
