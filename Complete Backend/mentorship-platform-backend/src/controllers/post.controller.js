// src/controllers/post.controller.js

const postService = require('../services/post.service');
const { successResponse, createdResponse, paginatedResponse, noContentResponse } = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { uploadPostImage } = require('../utils/cloudinaryUpload');
const { autoReportFlagged } = require('../middleware/toxicity');


/**
 * @swagger
 * /posts:
 *   get:
 *     summary: List posts with filtering and sorting
 *     tags: [Posts]
 */

async function getPosts(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { search, tag, sort, author, solved, anonymous } = req.query;

  const { posts, pagination } = await postService.getPosts(
    { page, limit, search, tag, sort, author, solved, anonymous },
    req.user?.id   ?? null,
    req.user?.role ?? null,
  );

  return paginatedResponse(res, { message: 'Posts fetched', data: posts, pagination });
}


/**
 * @swagger
 * /posts/trending-tags:
 *   get:
 *     summary: Get the most used tags (for sidebar/explore)
 *     tags: [Posts]
 */
async function getTrendingTags(req, res) {
  const limit = Math.min(parseInt(req.query.limit ?? '15', 10), 30);
  const tags  = await postService.getTrendingTags(limit);
  return successResponse(res, { message: 'Trending tags fetched', data: tags });
}

/**
 * @swagger
 * /posts/{id}:
 *   get:
 *     summary: Get a single post by ID
 *     tags: [Posts]
 */
async function getPostById(req, res) {
  const post = await postService.getPostById(
    req.params.id,
    req.user?.id   ?? null,
    req.user?.role ?? null,
  );

  // Async view count increment — never blocks response
  postService.incrementViewCount(post.id).catch(() => {});

  return successResponse(res, { message: 'Post fetched', data: post });
}

/**
 * @swagger
 * /posts/slug/{slug}:
 *   get:
 *     summary: Get a single post by URL slug
 *     tags: [Posts]
 */
async function getPostBySlug(req, res) {
  const post = await postService.getPostBySlug(
    req.params.slug,
    req.user?.id   ?? null,
    req.user?.role ?? null,
  );

  postService.incrementViewCount(post.id).catch(() => {});

  return successResponse(res, { message: 'Post fetched', data: post });
}

/**
 * @swagger
 * /posts:
 *   post:
 *     summary: Create a new post
 *     tags: [Posts]
 */
async function createPost(req, res) {
  // Handle optional image uploads (already in req.files from upload middleware)
  let imageUrls = [];
  if (req.files && req.files.length > 0) {
    const uploads = await Promise.all(
      req.files.map((f) => uploadPostImage(f.buffer, 'pending')),
    );
    imageUrls = uploads.map((u) => u.url);
  }

  const post = await postService.createPost(req.user.id, {
    ...req.body,
    imageUrls,
  });

  // If content was flagged (not rejected), auto-create a report
  if (req.toxicityFlag?.isFlagged) {
    autoReportFlagged({ reporterId: req.user.id, postId: post.id }).catch(() => {});
  }

  return createdResponse(res, { message: 'Post created', data: post });
}

/**
 * @swagger
 * /posts/{id}:
 *   patch:
 *     summary: Update a post (owner or admin only)
 *     tags: [Posts]
 */
async function updatePost(req, res) {
  const post = await postService.updatePost(
    req.params.id,
    req.user.id,
    req.user.role,
    req.body,
  );
  return successResponse(res, { message: 'Post updated', data: post });
}

/**
 * @swagger
 * /posts/{id}:
 *   delete:
 *     summary: Soft-delete a post (owner or admin only)
 *     tags: [Posts]
 */
async function deletePost(req, res) {
  await postService.deletePost(req.params.id, req.user.id, req.user.role);
  return successResponse(res, { message: 'Post deleted' });
}

/**
 * @swagger
 * /posts/{id}/solve:
 *   post:
 *     summary: Mark a comment as the accepted answer (post author only)
 *     tags: [Posts]
 */
async function markSolved(req, res) {
  const result = await postService.markSolved(
    req.params.id,
    req.user.id,
    req.body.commentId,
  );
  return successResponse(res, { message: 'Post marked as solved', data: result });
}

/**
 * @swagger
 * /posts/{id}/solve:
 *   delete:
 *     summary: Unmark solved status (post author only)
 *     tags: [Posts]
 */
async function unmarkSolved(req, res) {
  await postService.markSolved(req.params.id, req.user.id, null);
  return successResponse(res, { message: 'Solved status removed' });
}

module.exports = {
  getPosts,
  getTrendingTags,
  getPostById,
  getPostBySlug,
  createPost,
  updatePost,
  deletePost,
  markSolved,
  unmarkSolved,
};
