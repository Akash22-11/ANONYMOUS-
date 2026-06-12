// src/config/redis.js — Redis client (ioredis) + Upstash REST client

const Redis = require('ioredis');
const { logger } = require('../utils/logger');

// ─── ioredis client (local Docker Redis) ─────────────────────
let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;

  const isProduction = process.env.NODE_ENV === 'production';

  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        logger.error('Redis: max retries reached');
        return null; // stop retrying
      }
      return Math.min(times * 200, 2000);
    },
    reconnectOnError(err) {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ECONNREFUSED'];
      return targetErrors.some((e) => err.message.includes(e));
    },
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redisClient.on('connect', () => logger.info('Redis: connecting...'));
  redisClient.on('ready',   () => logger.info('Redis: ready'));
  redisClient.on('error',   (err) => logger.error(`Redis error: ${err.message}`));
  redisClient.on('close',   () => logger.warn('Redis: connection closed'));
  redisClient.on('reconnecting', () => logger.warn('Redis: reconnecting...'));

  return redisClient;
}

// ─── Upstash REST client (used by @upstash/ratelimit) ────────
let upstashClient = null;

function getUpstashClient() {
  if (upstashClient) return upstashClient;

  const { Redis: UpstashRedis } = require('@upstash/redis');

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    logger.warn('Upstash env vars not set — rate limiting will fall back to ioredis');
    return null;
  }

  upstashClient = new UpstashRedis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  return upstashClient;
}

// ─── Key helpers ─────────────────────────────────────────────
const RedisKeys = Object.freeze({
  refreshToken:      (userId) => `rt:${userId}`,
  otpCode:           (userId, purpose) => `otp:${userId}:${purpose}`,
  userSession:       (userId) => `session:${userId}`,
  onlineUsers:       () => 'online:users',
  postViews:         (postId) => `views:post:${postId}`,
  trendingPosts:     () => 'trending:posts',
  userRateLimit:     (userId, action) => `rl:${userId}:${action}`,
  ipRateLimit:       (ip, action) => `rl:ip:${ip}:${action}`,
  emailVerify:       (token) => `ev:${token}`,
  passwordReset:     (token) => `pr:${token}`,
  chatTyping:        (chatId) => `typing:${chatId}`,
  notifUnread:       (userId) => `notif:unread:${userId}`,
});

// ─── TTLs (seconds) ──────────────────────────────────────────
const TTL = Object.freeze({
  ACCESS_TOKEN:    15 * 60,           // 15 min
  REFRESH_TOKEN:   7 * 24 * 60 * 60, // 7 days
  OTP:             10 * 60,           // 10 min
  EMAIL_VERIFY:    24 * 60 * 60,      // 24 hours
  PASSWORD_RESET:  30 * 60,           // 30 min
  POST_VIEWS:      60 * 60,           // 1 hour (batch update)
  TRENDING:        10 * 60,           // 10 min
  TYPING_INDICATOR: 5,                // 5 sec
});

async function disconnectRedis() {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis disconnected');
  }
}

module.exports = { getRedisClient, getUpstashClient, RedisKeys, TTL, disconnectRedis };
