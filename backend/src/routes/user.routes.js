// src/routes/user.routes.js

const { Router } = require('express');
const controller   = require('../controllers/user.controller');
const { authenticate, optionalAuth, requireEmailVerified } = require('../middleware/auth');
const { requireMentor }   = require('../middleware/admin');
const { validateBody, validateQuery, validateParams } = require('../middleware/validation');
const { uploadAvatar }    = require('../middleware/upload');
const {
  updateProfileSchema,
  updateMentorProfileSchema,
  upsertAvailabilitySchema,
  getUsersQuerySchema,
  uuidParamSchema,
} = require('../validators/user.validator');
const { z } = require('zod');

const router = Router();

// ── Public / optional-auth routes ────────────────────────────

/**
 * GET /users
 * List users with filters. Auth optional (affects isFollowing field).
 */
router.get(
  '/',
  optionalAuth,
  validateQuery(getUsersQuerySchema),
  controller.getUsers,
);

/**
 * GET /users/:id
 * Public profile. Private profiles return minimal data unless owner.
 */
router.get(
  '/:id',
  optionalAuth,
  validateParams(uuidParamSchema),
  controller.getUserById,
);

/**
 * GET /users/:id/followers
 */
router.get(
  '/:id/followers',
  optionalAuth,
  validateParams(uuidParamSchema),
  controller.getFollowers,
);

/**
 * GET /users/:id/following
 */
router.get(
  '/:id/following',
  optionalAuth,
  validateParams(uuidParamSchema),
  controller.getFollowing,
);

// ── Authenticated routes ──────────────────────────────────────

/**
 * GET /users/me
 * Own full profile — must come before /:id to avoid conflict
 */
router.get(
  '/me',
  authenticate,
  controller.getMe,
);

/**
 * PATCH /users/me/profile
 */
router.patch(
  '/me/profile',
  authenticate,
  validateBody(updateProfileSchema),
  controller.updateProfile,
);

/**
 * POST /users/me/avatar
 */
router.post(
  '/me/avatar',
  authenticate,
  uploadAvatar,
  controller.uploadAvatar,
);

/**
 * DELETE /users/me/avatar
 */
router.delete(
  '/me/avatar',
  authenticate,
  controller.deleteAvatar,
);

/**
 * PUT /users/me/mentor-profile
 * Mentor role required
 */
router.put(
  '/me/mentor-profile',
  authenticate,
  requireEmailVerified,
  requireMentor,
  validateBody(updateMentorProfileSchema),
  controller.updateMentorProfile,
);

/**
 * PUT /users/me/availability
 * Replaces all availability slots for the mentor
 */
router.put(
  '/me/availability',
  authenticate,
  requireMentor,
  validateBody(upsertAvailabilitySchema),
  controller.upsertAvailability,
);

/**
 * POST /users/:id/follow
 */
router.post(
  '/:id/follow',
  authenticate,
  requireEmailVerified,
  validateParams(uuidParamSchema),
  controller.followUser,
);

/**
 * DELETE /users/:id/follow
 */
router.delete(
  '/:id/follow',
  authenticate,
  validateParams(uuidParamSchema),
  controller.unfollowUser,
);

/**
 * DELETE /users/me
 * Soft-delete own account — requires password confirmation in body
 */
router.delete(
  '/me',
  authenticate,
  validateBody(z.object({ password: z.string().min(1, 'Password is required') })),
  controller.deleteAccount,
);

module.exports = router;
