// src/utils/jwt.js — JWT sign, verify, and refresh logic

const jwt = require('jsonwebtoken');
const { getRedisClient, RedisKeys, TTL } = require('../config/redis');
const { logger } = require('./logger');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN  ?? '15m';
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be set in environment variables');
}

// ─── Sign ─────────────────────────────────────────────────────

/**
 * Create a short-lived access token
 */
function signAccessToken(payload) {
  return jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES,
    issuer:    'mentorship-platform',
  });
}

/**
 * Create a long-lived refresh token
 */
function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES,
    issuer:    'mentorship-platform',
  });
}

// ─── Verify ───────────────────────────────────────────────────

/**
 * Verify an access token — returns decoded payload or throws
 */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET, { issuer: 'mentorship-platform' });
}

/**
 * Verify a refresh token — returns decoded payload or throws
 */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET, { issuer: 'mentorship-platform' });
}

// ─── Token pair ───────────────────────────────────────────────

/**
 * Build the standard user payload for tokens
 */
function buildTokenPayload(user) {
  return {
    sub:   user.id,
    email: user.email,
    role:  user.role,
    alias: user.anonymousAlias,
  };
}

/**
 * Generate both tokens and persist refresh token in Redis
 */
async function generateTokenPair(user) {
  const payload = buildTokenPayload(user);
  const accessToken  = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Persist refresh token in Redis for rotation / revocation
  const redis = getRedisClient();
  await redis.setex(RedisKeys.refreshToken(user.id), TTL.REFRESH_TOKEN, refreshToken);

  return { accessToken, refreshToken };
}

/**
 * Rotate refresh token — invalidate old, issue new pair
 */
async function rotateTokenPair(user, oldRefreshToken) {
  const redis = getRedisClient();

  // Verify the stored token matches what was presented (rotation guard)
  const storedToken = await redis.get(RedisKeys.refreshToken(user.id));
  if (!storedToken || storedToken !== oldRefreshToken) {
    // Possible token reuse — revoke all sessions
    await redis.del(RedisKeys.refreshToken(user.id));
    throw new Error('Refresh token reuse detected — session revoked');
  }

  return generateTokenPair(user);
}

/**
 * Revoke a user's refresh token (logout)
 */
async function revokeRefreshToken(userId) {
  const redis = getRedisClient();
  await redis.del(RedisKeys.refreshToken(userId));
  logger.info(`Refresh token revoked for user ${userId}`);
}

/**
 * Extract token from Authorization header or cookie
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  return null;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateTokenPair,
  rotateTokenPair,
  revokeRefreshToken,
  extractBearerToken,
  buildTokenPayload,
};
