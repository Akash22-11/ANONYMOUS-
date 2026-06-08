// src/middleware/auth.js — JWT authentication + optional auth

const { verifyAccessToken, extractBearerToken } = require('../utils/jwt');
const { prisma } = require('../config/db');
const { HTTP } = require('../constants/statusCodes');
const { errorResponse } = require('../utils/response');

/**
 * Strict auth — request must have a valid access token
 */
async function authenticate(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return errorResponse(res, {
        message: 'Access token required',
        statusCode: HTTP.UNAUTHORIZED,
      });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      const message = err.name === 'TokenExpiredError'
        ? 'Access token expired'
        : 'Invalid access token';
      return errorResponse(res, { message, statusCode: HTTP.UNAUTHORIZED });
    }

    // Load minimal user from DB (confirm still active/not banned)
    const user = await prisma.user.findUnique({
      where:  { id: decoded.sub },
      select: {
        id: true, email: true, username: true, anonymousAlias: true,
        role: true, isActive: true, isBanned: true, isEmailVerified: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      return errorResponse(res, { message: 'User not found', statusCode: HTTP.UNAUTHORIZED });
    }

    if (!user.isActive || user.isBanned) {
      return errorResponse(res, {
        message: user.isBanned ? 'Your account has been banned' : 'Your account is inactive',
        statusCode: HTTP.FORBIDDEN,
      });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Optional auth — populates req.user if token is valid, never blocks
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractBearerToken(req);
    if (!token) return next();

    const decoded = verifyAccessToken(token);
    const user = await prisma.user.findUnique({
      where:  { id: decoded.sub },
      select: { id: true, email: true, username: true, anonymousAlias: true, role: true, isActive: true, isBanned: true },
    });

    if (user && user.isActive && !user.isBanned) {
      req.user = user;
    }
  } catch {
    // Silently continue — optional auth never blocks
  }
  return next();
}

/**
 * Require verified email
 */
function requireEmailVerified(req, res, next) {
  if (!req.user?.isEmailVerified) {
    return errorResponse(res, {
      message: 'Please verify your email address to access this feature',
      statusCode: HTTP.FORBIDDEN,
    });
  }
  return next();
}

module.exports = { authenticate, optionalAuth, requireEmailVerified };
