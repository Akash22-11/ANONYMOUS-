// src/routes/mentor.routes.js

const { Router }   = require('express');
const controller   = require('../controllers/mentor.controller');
const { authenticate, optionalAuth, requireEmailVerified } = require('../middleware/auth');
const { requireMentor } = require('../middleware/admin');
const { validateBody, validateQuery, validateParams }       = require('../middleware/validation');
const {
  createMentorRequestSchema,
  respondToRequestSchema,
  sessionFeedbackSchema,
  getMentorRequestsQuerySchema,
  getMentorsQuerySchema,
  uuidParam,
} = require('../validators/mentor.validator');

const router = Router();

// ── Public / optional-auth ──────────────────────────────────

/**
 * GET /mentors
 * Browse mentor directory — no auth required
 */
router.get(
  '/',
  optionalAuth,
  validateQuery(getMentorsQuerySchema),
  controller.getMentors,
);

/**
 * GET /mentors/:id
 * Single mentor profile page
 */
router.get(
  '/:id',
  optionalAuth,
  validateParams(uuidParam),
  controller.getMentorById,
);

// ── Authenticated ─────────────────────────────────────────────

/**
 * GET /mentors/requests
 * ?role=mentee (default) | mentor
 * ?status=PENDING | ACCEPTED | ...
 */
router.get(
  '/requests',
  authenticate,
  validateQuery(getMentorRequestsQuerySchema),
  controller.getRequests,
);

/**
 * POST /mentors/requests
 * Submit a new mentorship request — any verified user
 */
router.post(
  '/requests',
  authenticate,
  requireEmailVerified,
  validateBody(createMentorRequestSchema),
  controller.createRequest,
);

/**
 * PATCH /mentors/requests/:id/cancel
 * Requester cancels their own request
 */
router.patch(
  '/requests/:id/cancel',
  authenticate,
  validateParams(uuidParam),
  controller.cancelRequest,
);

/**
 * POST /mentors/requests/:id/feedback
 * Mentee submits session feedback after COMPLETED status
 */
router.post(
  '/requests/:id/feedback',
  authenticate,
  validateParams(uuidParam),
  validateBody(sessionFeedbackSchema),
  controller.submitFeedback,
);

// ── Mentor-only routes ─────────────────────────────────────────

/**
 * PATCH /mentors/requests/:id/respond
 * Mentor accepts or declines a request
 */
router.patch(
  '/requests/:id/respond',
  authenticate,
  requireMentor,
  validateParams(uuidParam),
  validateBody(respondToRequestSchema),
  controller.respondToRequest,
);

/**
 * PATCH /mentors/requests/:id/complete
 * Mentor marks a session as done
 */
router.patch(
  '/requests/:id/complete',
  authenticate,
  requireMentor,
  validateParams(uuidParam),
  controller.completeSession,
);

module.exports = router;
