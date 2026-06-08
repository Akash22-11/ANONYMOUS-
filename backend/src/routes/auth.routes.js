// src/routes/auth.routes.js

const { Router } = require('express');
const controller   = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { validateBody }  = require('../middleware/validation');
const { RateLimiters }  = require('../middleware/rateLimit');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} = require('../validators/auth.validator');

const router = Router();

// ── Public routes ─────────────────────────────────────────────

/**
 * POST /auth/register
 * Rate limited: 3 registrations per IP per hour
 */
router.post(
  '/register',
  RateLimiters.register,
  validateBody(registerSchema),
  controller.register,
);

/**
 * POST /auth/login
 * Rate limited: 5 attempts per IP per 15 minutes
 */
router.post(
  '/login',
  RateLimiters.login,
  validateBody(loginSchema),
  controller.login,
);

/**
 * POST /auth/refresh
 * Accepts token from cookie or body
 */
router.post(
  '/refresh',
  controller.refresh,
);

/**
 * POST /auth/verify-email
 */
router.post(
  '/verify-email',
  validateBody(verifyEmailSchema),
  controller.verifyEmail,
);

/**
 * POST /auth/resend-otp
 * Rate limited: 3 OTPs per email per hour
 */
router.post(
  '/resend-otp',
  RateLimiters.otp,
  validateBody(resendOtpSchema),
  controller.resendOtp,
);

/**
 * POST /auth/forgot-password
 * Rate limited: 3 requests per email per hour
 */
router.post(
  '/forgot-password',
  RateLimiters.forgotPwd,
  validateBody(forgotPasswordSchema),
  controller.forgotPassword,
);

/**
 * POST /auth/reset-password
 */
router.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  controller.resetPassword,
);

// ── Authenticated routes ──────────────────────────────────────

/**
 * GET /auth/me — token verification + claims
 */
router.get(
  '/me',
  authenticate,
  controller.getAuthStatus,
);

/**
 * POST /auth/logout
 */
router.post(
  '/logout',
  authenticate,
  controller.logout,
);

/**
 * POST /auth/change-password
 */
router.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  controller.changePassword,
);

module.exports = router;
