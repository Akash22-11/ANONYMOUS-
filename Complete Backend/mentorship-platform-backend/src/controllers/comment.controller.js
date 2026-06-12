// src/controllers/comment.controller.js

const commentService = require('../services/comment.service');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');
const { autoReportFlagged } = require('../middleware/toxicity');

/**
 * @swagger
 * /posts/{id}/comments:
 *   get:
 *     summary: Get top-level comments for a post (with one level of inline replies)
 *     tags: [Comments]
 */
async function getComments(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const sort = req.query.sort ?? 'top';

  const { comments, pagination } = await commentService.getComments(
    req.params.id,
    { page, limit, sort },
    req.user?.id   ?? null,
    req.user?.role ?? null,
  );

  return paginatedResponse(res, { message: 'Comments fetched', data: comments, pagination });
}

/**
 * @swagger
 * /comments/{id}/replies:
 *   get:
 *     summary: Get paginated replies to a specific comment
 *     tags: [Comments]
 */
async function getReplies(req, res) {
  const { page, limit } = parsePaginationParams(req.query);

  const { replies, pagination } = await commentService.getReplies(
    req.params.id,
    { page, limit },
    req.user?.id   ?? null,
    req.user?.role ?? null,
  );

  return paginatedResponse(res, { message: 'Replies fetched', data: replies, pagination });
}

/**
 * @swagger
 * /posts/{id}/comments:
 *   post:
 *     summary: Create a comment (or reply) on a post
 *     tags: [Comments]
 */
async function createComment(req, res) {
  const comment = await commentService.createComment(
    req.user.id,
    req.params.id,      // postId from URL
    req.body,
  );

  if (req.toxicityFlag?.isFlagged) {
    autoReportFlagged({ reporterId: req.user.id, commentId: comment.id }).catch(() => {});
  }

  return createdResponse(res, { message: 'Comment created', data: comment });
}

/**
 * @swagger
 * /comments/{id}:
 *   patch:
 *     summary: Edit a comment (owner or admin only)
 *     tags: [Comments]
 */
async function updateComment(req, res) {
  const comment = await commentService.updateComment(
    req.params.id,
    req.user.id,
    req.user.role,
    req.body,
  );
  return successResponse(res, { message: 'Comment updated', data: comment });
}

/**
 * @swagger
 * /comments/{id}:
 *   delete:
 *     summary: Soft-delete a comment (owner or admin only)
 *     tags: [Comments]
 */
async function deleteComment(req, res) {
  await commentService.deleteComment(req.params.id, req.user.id, req.user.role);
  return successResponse(res, { message: 'Comment deleted' });
}

module.exports = { getComments, getReplies, createComment, updateComment, deleteComment };
