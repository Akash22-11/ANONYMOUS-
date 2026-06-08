// src/routes/report.routes.js

const { Router } = require('express');
const reportCtrl     = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { validateBody, validateQuery, validateParams } = require('../middleware/validation');
const { createReportSchema, uuidParamSchema } = require('../validators/comment.validator');
const { z } = require('zod');

const router = Router();

// All report routes require authentication
router.use(authenticate);

/**
 * POST /reports
 * Any authenticated user can submit a report
 */
router.post(
  '/',
  validateBody(createReportSchema),
  reportCtrl.createReport,
);

/**
 * GET /reports/mine
 * View your own submitted reports — must be before /:id
 */
router.get(
  '/mine',
  reportCtrl.getMyReports,
);

// ── Admin-only routes ──────────────────────────────────────────

/**
 * GET /reports
 * Paginated list with optional filters: ?status=PENDING&targetType=post
 */
router.get(
  '/',
  requireAdmin,
  validateQuery(
    z.object({
      page:       z.coerce.number().int().min(1).default(1),
      limit:      z.coerce.number().int().min(1).max(50).default(20),
      status:     z.enum(['PENDING', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED']).optional(),
      reason:     z.enum(['SPAM', 'HARASSMENT', 'OFFENSIVE_CONTENT', 'MISINFORMATION', 'PLAGIARISM', 'INAPPROPRIATE', 'OTHER']).optional(),
      targetType: z.enum(['post', 'comment', 'user', 'resource']).optional(),
    }),
  ),
  reportCtrl.getReports,
);

/**
 * PATCH /reports/:id/resolve
 * Admin resolves or dismisses a report
 */
router.patch(
  '/:id/resolve',
  requireAdmin,
  validateParams(uuidParamSchema),
  validateBody(
    z.object({
      status:     z.enum(['RESOLVED', 'DISMISSED']),
      resolution: z.string().max(500).trim().optional(),
    }),
  ),
  reportCtrl.resolveReport,
);

module.exports = router;
