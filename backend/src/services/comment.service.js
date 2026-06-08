// src/services/comment.service.js

const { prisma }  = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');

const MAX_DEPTH = 3; // Maximum nesting depth for threaded replies

// ─── Shared select ────────────────────────────────────────────
const COMMENT_SELECT = {
  id: true, postId: true, parentId: true, body: true,
  isAnonymous: true, isBestAnswer: true, depth: true,
  upvoteCount: true, downvoteCount: true,
  isEdited: true, editedAt: true, deletedAt: true,
  createdAt: true, updatedAt: true,
  author: {
    select: {
      id: true, username: true, anonymousAlias: true,
      profile: { select: { displayName: true, avatarUrl: true, reputationPoints: true } },
    },
  },
  _count: { select: { replies: true } },
};

function applyAnonymity(comment, requestingUserId, requestingRole) {
  if (!comment.isAnonymous) return comment;
  const isOwner = comment.author?.id === requestingUserId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(requestingRole);
  if (isOwner || isAdmin) return comment;
  return {
    ...comment,
    author: { id: null, username: null, anonymousAlias: comment.author?.anonymousAlias ?? null, profile: null },
  };
}

// ─────────────────────────────────────────────────────────────
// createComment
// ─────────────────────────────────────────────────────────────
async function createComment(authorId, postId, { body, parentId, isAnonymous }) {
  // Verify the post exists and is active
  const post = await prisma.post.findFirst({
    where:  { id: postId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, authorId: true },
  });
  if (!post) throw new AppError('Post not found or not available for comments', HTTP.NOT_FOUND);

  let depth = 0;

  if (parentId) {
    const parent = await prisma.comment.findFirst({
      where:  { id: parentId, postId, deletedAt: null },
      select: { id: true, depth: true },
    });
    if (!parent) throw new AppError('Parent comment not found on this post', HTTP.NOT_FOUND);
    if (parent.depth >= MAX_DEPTH) {
      throw new AppError(`Maximum reply depth (${MAX_DEPTH}) reached`, HTTP.BAD_REQUEST, 'MAX_DEPTH_EXCEEDED');
    }
    depth = parent.depth + 1;
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: { authorId, postId, parentId: parentId ?? null, body, isAnonymous, depth },
      select: COMMENT_SELECT,
    });

    // Keep denormalized commentCount in sync
    await tx.post.update({
      where: { id: postId },
      data:  { commentCount: { increment: 1 } },
    });

    // Reputation for author
    await tx.profile.update({
      where: { userId: authorId },
      data:  { reputationPoints: { increment: 2 } },
    });

    return created;
  });

  return applyAnonymity(comment, authorId, null);
}

// ─────────────────────────────────────────────────────────────
// getComments — top-level comments for a post with nested replies
// ─────────────────────────────────────────────────────────────
async function getComments(postId, { page, limit, sort }, requestingUserId, requestingRole) {
  const skip = (page - 1) * limit;

  const orderByMap = {
    top:    [{ isBestAnswer: 'desc' }, { upvoteCount: 'desc' }],
    latest: [{ createdAt: 'desc' }],
    oldest: [{ createdAt: 'asc' }],
  };

  // Fetch top-level comments (parentId is null)
  const [topLevel, total] = await Promise.all([
    prisma.comment.findMany({
      where:   { postId, parentId: null, deletedAt: null },
      select:  COMMENT_SELECT,
      orderBy: orderByMap[sort] ?? orderByMap.top,
      skip,
      take:    limit,
    }),
    prisma.comment.count({ where: { postId, parentId: null, deletedAt: null } }),
  ]);

  // For each top-level comment, eagerly load one level of replies
  const withReplies = await Promise.all(
    topLevel.map(async (c) => {
      const replies = await prisma.comment.findMany({
        where:   { parentId: c.id, deletedAt: null },
        select:  COMMENT_SELECT,
        orderBy: [{ upvoteCount: 'desc' }, { createdAt: 'asc' }],
        take:    10, // max 10 direct replies shown inline
      });

      return {
        ...applyAnonymity(c, requestingUserId, requestingRole),
        replies: replies.map((r) => applyAnonymity(r, requestingUserId, requestingRole)),
      };
    }),
  );

  const pagination = buildPaginationMeta({ total, page, limit, data: topLevel });
  return { comments: withReplies, pagination };
}

// ─────────────────────────────────────────────────────────────
// getReplies — paginated replies to a specific comment
// ─────────────────────────────────────────────────────────────
async function getReplies(commentId, { page, limit }, requestingUserId, requestingRole) {
  const skip = (page - 1) * limit;

  const parent = await prisma.comment.findFirst({
    where: { id: commentId, deletedAt: null },
    select: { id: true },
  });
  if (!parent) throw new AppError('Comment not found', HTTP.NOT_FOUND);

  const [replies, total] = await Promise.all([
    prisma.comment.findMany({
      where:   { parentId: commentId, deletedAt: null },
      select:  COMMENT_SELECT,
      orderBy: [{ createdAt: 'asc' }],
      skip,
      take:    limit,
    }),
    prisma.comment.count({ where: { parentId: commentId, deletedAt: null } }),
  ]);

  const data       = replies.map((r) => applyAnonymity(r, requestingUserId, requestingRole));
  const pagination = buildPaginationMeta({ total, page, limit, data });
  return { replies: data, pagination };
}

// ─────────────────────────────────────────────────────────────
// updateComment
// ─────────────────────────────────────────────────────────────
async function updateComment(commentId, userId, role, { body }) {
  const comment = await prisma.comment.findFirst({
    where:  { id: commentId, deletedAt: null },
    select: { id: true, authorId: true },
  });

  if (!comment) throw new AppError('Comment not found', HTTP.NOT_FOUND);

  const isOwner = comment.authorId === userId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);
  if (!isOwner && !isAdmin) throw new AppError('You do not have permission to edit this comment', HTTP.FORBIDDEN);

  const updated = await prisma.comment.update({
    where:  { id: commentId },
    data:   { body, isEdited: true, editedAt: new Date() },
    select: COMMENT_SELECT,
  });

  return applyAnonymity(updated, userId, role);
}

// ─────────────────────────────────────────────────────────────
// deleteComment — soft delete
// ─────────────────────────────────────────────────────────────
async function deleteComment(commentId, userId, role) {
  const comment = await prisma.comment.findFirst({
    where:  { id: commentId, deletedAt: null },
    select: { id: true, authorId: true, postId: true, isBestAnswer: true },
  });

  if (!comment) throw new AppError('Comment not found', HTTP.NOT_FOUND);

  const isOwner = comment.authorId === userId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);
  if (!isOwner && !isAdmin) throw new AppError('You do not have permission to delete this comment', HTTP.FORBIDDEN);

  await prisma.$transaction(async (tx) => {
    await tx.comment.update({
      where: { id: commentId },
      data:  { deletedAt: new Date(), body: '[deleted]' },
    });

    await tx.post.update({
      where: { id: comment.postId },
      data:  { commentCount: { decrement: 1 } },
    });

    // If this was the accepted answer, unsolve the post
    if (comment.isBestAnswer) {
      await tx.post.update({
        where: { id: comment.postId },
        data:  { isSolved: false, solvedCommentId: null },
      });
    }
  });

  return { deleted: true };
}

module.exports = {
  createComment,
  getComments,
  getReplies,
  updateComment,
  deleteComment,
};
