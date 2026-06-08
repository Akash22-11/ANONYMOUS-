// src/routes/post.routes.js

const { Router } = require('express');
const postCtrl    = require('../controllers/post.controller');
const commentCtrl = require('../controllers/comment.controller');
const { authenticate, optionalAuth, requireEmailVerified } = require('../middleware/auth');
const { validateBody, validateQuery, validateParams }      = require('../middleware/validation');
const { RateLimiters }   = require('../middleware/rateLimit');
const { checkToxicity }  = require('../middleware/toxicity');
const { uploadImage }    = require('../middleware/upload');
const {
  createPostSchema,
  updatePostSchema,
  getPostsQuerySchema,
  getPostCommentsQuerySchema,
  markSolvedSchema,
  uuidParamSchema,
  slugParamSchema,
} = require('../validators/post.validator');
const {
  createCommentSchema,
  getCommentsQuerySchema,
} = require('../validators/comment.validator');
const { z } = require('zod');

const router = Router();

// ── Public / optional-auth ─────────────────────────────────────

/**
 * GET /posts
 * Full feed with sort modes: trending | latest | top | unanswered
 */
router.get(
  '/',
  optionalAuth,
  validateQuery(getPostsQuerySchema),
  postCtrl.getPosts,
);

/**
 * GET /posts/trending-tags
 * Must be defined BEFORE /:id to avoid route collision
 */
router.get(
  '/trending-tags',
  postCtrl.getTrendingTags,
);

/**
 * GET /posts/slug/:slug
 * SEO-friendly slug-based lookup
 */
router.get(
  '/slug/:slug',
  optionalAuth,
  validateParams(slugParamSchema),
  postCtrl.getPostBySlug,
);

/**
 * GET /posts/:id
 */
router.get(
  '/:id',
  optionalAuth,
  validateParams(uuidParamSchema),
  postCtrl.getPostById,
);

/**
 * GET /posts/:id/comments
 */
router.get(
  '/:id/comments',
  optionalAuth,
  validateParams(uuidParamSchema),
  validateQuery(getCommentsQuerySchema),
  commentCtrl.getComments,
);

// ── Authenticated ──────────────────────────────────────────────

/**
 * POST /posts
 * Rate limited, toxicity checked, optional image upload
 */
router.post(
  '/',
  authenticate,
  requireEmailVerified,
  RateLimiters.postCreate,
  uploadImage,                              // multer: up to 4 images
  validateBody(createPostSchema),
  checkToxicity(['title', 'body']),
  postCtrl.createPost,
);

/**
 * PATCH /posts/:id
 */
router.patch(
  '/:id',
  authenticate,
  validateParams(uuidParamSchema),
  validateBody(updatePostSchema),
  checkToxicity(['title', 'body']),
  postCtrl.updatePost,
);

/**
 * DELETE /posts/:id
 */
router.delete(
  '/:id',
  authenticate,
  validateParams(uuidParamSchema),
  postCtrl.deletePost,
);

/**
 * POST /posts/:id/solve — mark a comment as best answer
 */
router.post(
  '/:id/solve',
  authenticate,
  validateParams(uuidParamSchema),
  validateBody(markSolvedSchema),
  postCtrl.markSolved,
);

/**
 * DELETE /posts/:id/solve — remove solved status
 */
router.delete(
  '/:id/solve',
  authenticate,
  validateParams(uuidParamSchema),
  postCtrl.unmarkSolved,
);

/**
 * POST /posts/:id/comments — create a comment or reply on a post
 */
router.post(
  '/:id/comments',
  authenticate,
  requireEmailVerified,
  RateLimiters.comment,
  validateParams(uuidParamSchema),
  validateBody(createCommentSchema),
  checkToxicity(['body']),
  commentCtrl.createComment,
);

module.exports = router;
