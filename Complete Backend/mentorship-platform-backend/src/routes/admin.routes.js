// src/routes/admin.routes.js

const { Router } = require('express');
const controller    = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireSuperAdmin } = require('../middleware/admin');
const { validateBody, validateQuery, validateParams } = require('../middleware/validation');
const {
  banUserSchema,
  updatePostStatusSchema,
  reviewResourceSchema,
  changeUserRoleSchema,
  verifyMentorSchema,
  analyticsQuerySchema,
  adminUsersQuerySchema,
  uuidParam,
} = require('../validators/admin.validator');
const { z } = require('zod');

const router = Router();

// All admin routes: must be authenticated + ADMIN role minimum
router.use(authenticate);
router.use(requireAdmin);

// ─── Dashboard ────────────────────────────────────────────────

/**
 * GET /admin/analytics
 * ?period=7d | 30d | 90d | all
 */
router.get(
  '/analytics',
  validateQuery(analyticsQuerySchema),
  controller.getAnalytics,
);

// ─── User management ──────────────────────────────────────────

/**
 * GET /admin/users
 */
router.get(
  '/users',
  validateQuery(adminUsersQuerySchema),
  controller.getUsers,
);

/**
 * GET /admin/users/:id
 */
router.get(
  '/users/:id',
  validateParams(uuidParam),
  controller.getUserDetail,
);

/**
 * POST /admin/users/:id/ban
 */
router.post(
  '/users/:id/ban',
  validateParams(uuidParam),
  validateBody(banUserSchema),
  controller.banUser,
);

/**
 * POST /admin/users/:id/unban
 */
router.post(
  '/users/:id/unban',
  validateParams(uuidParam),
  controller.unbanUser,
);

/**
 * PATCH /admin/users/:id/role
 * Super admin only — prevents privilege escalation by regular admins
 */
router.patch(
  '/users/:id/role',
  requireSuperAdmin,
  validateParams(uuidParam),
  validateBody(changeUserRoleSchema),
  controller.changeUserRole,
);

// ─── Post moderation ──────────────────────────────────────────

/**
 * PATCH /admin/posts/:id/status
 */
router.patch(
  '/posts/:id/status',
  validateParams(uuidParam),
  validateBody(updatePostStatusSchema),
  controller.updatePostStatus,
);

/**
 * DELETE /admin/posts/:id
 */
router.delete(
  '/posts/:id',
  validateParams(uuidParam),
  validateBody(z.object({ reason: z.string().trim().max(300).optional() })),
  controller.deletePost,
);

// ─── Resource moderation ──────────────────────────────────────

/**
 * GET /admin/resources/pending
 * FIFO approval queue
 */
router.get(
  '/resources/pending',
  controller.getPendingResources,
);

/**
 * PATCH /admin/resources/:id/review
 */
router.patch(
  '/resources/:id/review',
  validateParams(uuidParam),
  validateBody(reviewResourceSchema),
  controller.reviewResource,
);

// ─── Mentor verification ──────────────────────────────────────

/**
 * PATCH /admin/mentors/:id/verify
 */
router.patch(
  '/mentors/:id/verify',
  validateParams(uuidParam),
  validateBody(verifyMentorSchema),
  controller.verifyMentor,
);

// ─── Audit log ────────────────────────────────────────────────

/**
 * GET /admin/audit-log
 * ?adminId=<uuid>&actionType=ban_user&page=1&limit=20
 */
router.get(
  '/audit-log',
  validateQuery(
    z.object({
      page:       z.coerce.number().int().min(1).default(1),
      limit:      z.coerce.number().int().min(1).max(100).default(20),
      adminId:    z.string().uuid().optional(),
      actionType: z.string().trim().optional(),
    }),
  ),
  controller.getAuditLog,
);

module.exports = router;
