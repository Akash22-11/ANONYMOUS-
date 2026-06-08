// src/middleware/rateLimit.js — Redis-backed rate limiting

const { Ratelimit } = require('@upstash/ratelimit');
const { getUpstashClient, getRedisClient } = require('../config/redis');
const { HTTP } = require('../constants/statusCodes');
const { logger } = require('../utils/logger');

// ─── Sliding window rate limiter factory ─────────────────────

/**
 * Create a rate limiter using Upstash (production) or ioredis (development)
 * @param {number} requests - number of requests allowed
 * @param {string} window   - time window e.g. '15m', '1h', '1d'
 * @param {string} prefix   - Redis key prefix
 */
function createRateLimiter(requests, window, prefix) {
  const upstash = getUpstashClient();

  if (upstash) {
    // Production: Upstash sliding window
    return new Ratelimit({
      redis:     upstash,
      limiter:   Ratelimit.slidingWindow(requests, window),
      prefix:    `rl:${prefix}`,
      analytics: true,
    });
  }

  // Fallback: ioredis manual implementation
  return null;
}

// ─── ioredis fallback limiter ─────────────────────────────────

async function ioRedisRateLimit(redis, key, limit, windowSecs) {
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSecs);
  }
  const ttl = await redis.ttl(key);
  return {
    allowed:   current <= limit,
    remaining: Math.max(0, limit - current),
    reset:     Date.now() + ttl * 1000,
  };
}

// ─── Middleware factory ───────────────────────────────────────

function parseWindowToSeconds(window) {
  const map = { s: 1, m: 60, h: 3600, d: 86400 };
  const match = window.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // default 15m
  return parseInt(match[1], 10) * (map[match[2]] ?? 60);
}

/**
 * Express middleware for rate limiting
 * @param {{ requests: number, window: string, prefix: string, keyFn?: (req) => string }}
 */
function rateLimitMiddleware({ requests, window: win, prefix, keyFn }) {
  const limiter = createRateLimiter(requests, win, prefix);
  const windowSecs = parseWindowToSeconds(win);

  return async (req, res, next) => {
    try {
      const identifier = keyFn ? keyFn(req) : (req.user?.id ?? req.ip ?? 'anonymous');
      const key = `rl:${prefix}:${identifier}`;

      let result;

      if (limiter) {
        // Upstash path
        const r = await limiter.limit(identifier);
        result = { allowed: r.success, remaining: r.remaining, reset: r.reset };
      } else {
        // ioredis fallback
        const redis = getRedisClient();
        result = await ioRedisRateLimit(redis, key, requests, windowSecs);
      }

      // Set standard rate limit headers
      res.setHeader('X-RateLimit-Limit',     requests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset',     Math.ceil(result.reset / 1000));

      if (!result.allowed) {
        logger.warn(`Rate limit exceeded: ${key}`);
        return res.status(HTTP.TOO_MANY_REQUESTS).json({
          success: false,
          message: 'Too many requests. Please slow down.',
          code:    'RATE_LIMITED',
          retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
        });
      }

      return next();
    } catch (err) {
      // Never block traffic on rate-limit errors — fail open
      logger.error(`Rate limit middleware error: ${err.message}`);
      return next();
    }
  };
}

// ─── Preconfigured limiters ───────────────────────────────────

const RateLimiters = {
  /** Auth endpoints */
  login:       rateLimitMiddleware({ requests: 5,   window: '15m', prefix: 'login',       keyFn: (req) => req.ip }),
  register:    rateLimitMiddleware({ requests: 3,   window: '1h',  prefix: 'register',     keyFn: (req) => req.ip }),
  otp:         rateLimitMiddleware({ requests: 3,   window: '1h',  prefix: 'otp',          keyFn: (req) => req.body?.email ?? req.ip }),
  forgotPwd:   rateLimitMiddleware({ requests: 3,   window: '1h',  prefix: 'forgot-pwd',   keyFn: (req) => req.body?.email ?? req.ip }),

  /** Content */
  postCreate:  rateLimitMiddleware({ requests: 10,  window: '1h',  prefix: 'post-create',  keyFn: (req) => req.user?.id }),
  comment:     rateLimitMiddleware({ requests: 30,  window: '1h',  prefix: 'comment',       keyFn: (req) => req.user?.id }),
  vote:        rateLimitMiddleware({ requests: 100, window: '1h',  prefix: 'vote',          keyFn: (req) => req.user?.id }),

  /** Chat */
  chatMessage: rateLimitMiddleware({ requests: 30,  window: '1m',  prefix: 'chat-msg',     keyFn: (req) => req.user?.id }),

  /** Resources */
  upload:      rateLimitMiddleware({ requests: 5,   window: '1h',  prefix: 'upload',       keyFn: (req) => req.user?.id }),

  /** General API */
  api:         rateLimitMiddleware({ requests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS ?? '100', 10), window: '15m', prefix: 'api', keyFn: (req) => req.ip }),
};

module.exports = { rateLimitMiddleware, RateLimiters };
