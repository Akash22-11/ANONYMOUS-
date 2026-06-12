// src/routes/resource.routes.js

const { Router } = require('express');
const controller = require('../controllers/resource.controller');
const { authenticate, optionalAuth, requireEmailVerified } = require('../middleware/auth');
const { validateBody, validateQuery, validateParams }       = require('../middleware/validation');
const { RateLimiters }  = require('../middleware/rateLimit');
const { checkToxicity } = require('../middleware/toxicity');
const { uploadDocument } = require('../middleware/upload');
const {
  createResourceSchema,
  updateResourceSchema,
  getResourcesQuerySchema,
  uuidParam,
} = require('../validators/resource.validator');

const router = Router();

// ── Public / optional-auth ─────────────────────────────────────

/**
 * GET /resources
 * Browse approved resources with filters
 */
router.get(
  '/',
  optionalAuth,
  validateQuery(getResourcesQuerySchema),
  controller.getResources,
);

/**
 * GET /resources/:id
 */
router.get(
  '/:id',
  optionalAuth,
  validateParams(uuidParam),
  controller.getResourceById,
);

/**
 * GET /resources/:id/download
 * Returns the file URL (or redirect target) and bumps download counter
 */
router.get(
  '/:id/download',
  optionalAuth,
  validateParams(uuidParam),
  controller.downloadResource,
);

// ── Authenticated ──────────────────────────────────────────────

/**
 * POST /resources
 * File upload (PDF, doc) OR link/video (no file required)
 * Rate limited + toxicity checked on title/description
 */
router.post(
  '/',
  authenticate,
  requireEmailVerified,
  RateLimiters.upload,
  uploadDocument,                             // multer: single 'file' field
  validateBody(createResourceSchema),
  checkToxicity(['title', 'description']),
  controller.createResource,
);

/**
 * PATCH /resources/:id
 */
router.patch(
  '/:id',
  authenticate,
  validateParams(uuidParam),
  validateBody(updateResourceSchema),
  checkToxicity(['title', 'description']),
  controller.updateResource,
);

/**
 * DELETE /resources/:id
 * Owner or admin
 */
router.delete(
  '/:id',
  authenticate,
  validateParams(uuidParam),
  controller.deleteResource,
);

module.exports = router;
