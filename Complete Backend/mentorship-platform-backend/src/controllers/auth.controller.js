// src/controllers/auth.controller.js

const authService = require('../services/auth.service');
const {
  successResponse,
  createdResponse,
  errorResponse,
} = require('../utils/response');
const { HTTP } = require('../constants/statusCodes');
const { logger } = require('../utils/logger');


// Shared cookie options for refresh token

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days in ms
  path:     '/api/v1/auth/refresh',
};

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new student account
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, displayName]
 *             properties:
 *               email:       { type: string, format: email }
 *               password:    { type: string, minLength: 8 }
 *               displayName: { type: string, minLength: 2 }
 *               college:     { type: string }
 *               department:  { type: string }
 *               year:        { type: string, enum: [FIRST, SECOND, THIRD, FOURTH, FIFTH, ALUMNI] }
 *     responses:
 *       201: { description: Account created, OTP sent to email }
 *       409: { description: Email already registered }
 *       422: { description: Validation error }
 */


async function register(req, res) {
  const user = await authService.register(req.body);
  return createdResponse(res, {
    message: 'Account created. Please verify your email with the OTP sent to your inbox.',
    data: {
      id:             user.id,
      email:          user.email,
      username:       user.username,
      anonymousAlias: user.anonymousAlias,
      displayName:    user.profile?.displayName,
      isEmailVerified: user.isEmailVerified,
    },
  });
}

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 *     security: []
 */

async function login(req, res) {
  const { user, accessToken, refreshToken } = await authService.login(req.body);


  
  // Set refresh token as httpOnly cookie
  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

  return successResponse(res, {
    message: 'Login successful',
    data: {
      accessToken,
      user: {
        id:             user.id,
        email:          user.email,
        username:       user.username,
        anonymousAlias: user.anonymousAlias,
        role:           user.role,
        isEmailVerified: user.isEmailVerified,
      },
    },
  });
}


/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout — revoke refresh token
 *     tags: [Auth]
 */

async function logout(req, res) {
  await authService.logout(req.user.id);

  
  // Clear the cookie
  res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
  return successResponse(res, { message: 'Logged out successfully' });
}

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Exchange refresh token for a new access token
 *     tags: [Auth]
 *     security: []
 */
async function refresh(req, res) {
  // Accept from cookie OR request body (for non-browser clients)
  const incomingToken = req.cookies?.refreshToken ?? req.body?.refreshToken;

  if (!incomingToken) {
    return errorResponse(res, {
      message: 'Refresh token is required',
      statusCode: HTTP.UNAUTHORIZED,
    });
  }

  const { user, accessToken, refreshToken } = await authService.refreshTokens(incomingToken);

  // Rotate the cookie
  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

  return successResponse(res, {
    message: 'Token refreshed',
    data: {
      accessToken,
      user: {
        id:   user.id,
        role: user.role,
        anonymousAlias: user.anonymousAlias,
      },
    },
  });
}

/**
 * @swagger
 * /auth/verify-email:
 *   post:
 *     summary: Verify email address with OTP
 *     tags: [Auth]
 *     security: []
 */
async function verifyEmail(req, res) {
  const result = await authService.verifyEmail(req.body);
  return successResponse(res, {
    message: 'Email verified successfully. Welcome aboard!',
    data: result,
  });
}

/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     summary: Resend an OTP code
 *     tags: [Auth]
 *     security: []
 */
async function resendOtp(req, res) {
  const result = await authService.resendOtp(req.body);
  return successResponse(res, {
    message: 'If an account exists with this email, a new OTP has been sent.',
    data: result,
  });
}

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Auth]
 *     security: []
 */
async function forgotPassword(req, res) {
  const result = await authService.forgotPassword(req.body);
  return successResponse(res, {
    message: 'If an account exists with this email, a password reset OTP has been sent.',
    data: result,
  });
}

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password using OTP
 *     tags: [Auth]
 *     security: []
 */
async function resetPassword(req, res) {
  const result = await authService.resetPassword(req.body);
  return successResponse(res, {
    message: 'Password reset successfully. Please log in with your new password.',
    data: result,
  });
}

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change password (authenticated)
 *     tags: [Auth]
 */
async function changePassword(req, res) {
  const result = await authService.changePassword(req.user.id, req.body);

  // Rotate cookie after password change
  res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });

  return successResponse(res, {
    message: 'Password changed successfully. Please log in again on all devices.',
    data: result,
  });
}

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current authenticated user's token claims
 *     tags: [Auth]
 */
async function getAuthStatus(req, res) {
  return successResponse(res, {
    message: 'Authenticated',
    data: {
      id:             req.user.id,
      email:          req.user.email,
      role:           req.user.role,
      anonymousAlias: req.user.anonymousAlias,
      isEmailVerified: req.user.isEmailVerified,
    },
  });
}

module.exports = {
  register,
  login,
  logout,
  refresh,
  verifyEmail,
  resendOtp,
  forgotPassword,
  resetPassword,
  changePassword,
  getAuthStatus,
};
