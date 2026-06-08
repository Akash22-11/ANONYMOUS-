// src/routes/comment.routes.js
// Handles comment-centric operations (edit, delete, replies, votes on comments)

const { Router } = require('express');
const commentCtrl = require('../controllers/comment.controller');
const voteCtrl    = require('../controllers/vote.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { validateBody, validateQuery, validateParams } = require('../middleware/validation');
const { checkToxicity } = require('../middleware/toxicity');
const { RateLimiters }  = require('../middleware/rateLimit');
const { updateCommentSchema, getCommentsQuerySchema, voteSchema, uuidParamSchema } = require('../validators/comment.validator');
const { z } = require('zod');

const router = Router();

// ── Comment CRUD ───────────────────────────────────────────────

/**
 * GET /comments/:id/replies
 * Paginated deep-load of replies beyond the inline 10
 */
router.get(
  '/:id/replies',
  optionalAuth,
  validateParams(uuidParamSchema),
  validateQuery(getCommentsQuerySchema),
  commentCtrl.getReplies,
);

/**
 * PATCH /comments/:id
 */
router.patch(
  '/:id',
  authenticate,
  validateParams(uuidParamSchema),
  validateBody(updateCommentSchema),
  checkToxicity(['body']),
  commentCtrl.updateComment,
);

/**
 * DELETE /comments/:id
 */
router.delete(
  '/:id',
  authenticate,
  validateParams(uuidParamSchema),
  commentCtrl.deleteComment,
);

// ── Votes ──────────────────────────────────────────────────────

/**
 * POST /votes
 * Unified vote endpoint — post or comment, up or down
 */
router.post(
  '/votes',
  authenticate,
  RateLimiters.vote,
  validateBody(voteSchema),
  voteCtrl.castVote,
);

/**
 * POST /votes/my-votes
 * Batch fetch user's vote state for a page of content
 */
router.post(
  '/votes/my-votes',
  authenticate,
  validateBody(
    z.object({
      postIds:    z.array(z.string().uuid()).max(50).optional(),
      commentIds: z.array(z.string().uuid()).max(100).optional(),
    }),
  ),
  voteCtrl.getUserVotes,
);

module.exports = router;
