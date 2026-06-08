// src/services/post.service.js

const { prisma }  = require('../config/db');
const { getRedisClient, RedisKeys, TTL } = require('../config/redis');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');
const { logger }  = require('../utils/logger');

// ─── Shared select shape ──────────────────────────────────────

const POST_SELECT = {
  id: true, title: true, body: true, slug: true, isAnonymous: true,
  status: true, isPinned: true, isSolved: true, solvedCommentId: true,
  viewCount: true, upvoteCount: true, downvoteCount: true, commentCount: true,
  trendingScore: true, imageUrls: true, editedAt: true, createdAt: true, updatedAt: true,
  author: {
    select: {
      id: true, username: true, anonymousAlias: true,
      profile: { select: { displayName: true, avatarUrl: true, college: true, reputationPoints: true } },
    },
  },
  tags: { select: { tag: { select: { id: true, name: true, slug: true, color: true } } } },
};

// Strip author identity for anonymous posts when caller is not the owner/admin
function applyAnonymity(post, requestingUserId, requestingRole) {
  if (!post.isAnonymous) return post;
  const isOwner = post.author?.id === requestingUserId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(requestingRole);
  if (isOwner || isAdmin) return post;
  return {
    ...post,
    author: { id: null, username: null, anonymousAlias: post.author?.anonymousAlias ?? null, profile: null },
  };
}

// Normalise tag join to flat array
function normalizeTags(post) {
  return { ...post, tags: post.tags?.map((t) => t.tag) ?? [] };
}

// ─── Trending score algorithm ─────────────────────────────────
// Score = (upvotes - downvotes + commentCount*0.5) / (age_hours + 2)^gravity
function computeTrendingScore(upvotes, downvotes, comments, createdAt) {
  const GRAVITY = 1.5;
  const votes   = upvotes - downvotes + comments * 0.5;
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  return votes / Math.pow(ageHours + 2, GRAVITY);
}

// ─────────────────────────────────────────────────────────────
// createPost
// ─────────────────────────────────────────────────────────────
async function createPost(authorId, { title, body, isAnonymous, tagSlugs }, imageUrls = []) {
  // Resolve tags — only insert tags that exist in the Tag table
  const tags = await prisma.tag.findMany({
    where: { slug: { in: tagSlugs } },
    select: { id: true, slug: true },
  });

  if (tags.length === 0) {
    throw new AppError('No valid tags found. Please use existing tags.', HTTP.BAD_REQUEST, 'INVALID_TAGS');
  }

  // Generate URL-safe slug
  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
  const slug = `${baseSlug}-${Date.now().toString(36)}`;

  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        authorId, title, body, isAnonymous,
        slug, imageUrls,
        status: 'ACTIVE',
        trendingScore: computeTrendingScore(0, 0, 0, new Date()),
        tags: {
          create: tags.map((t) => ({ tag: { connect: { id: t.id } } })),
        },
      },
      select: POST_SELECT,
    });

    // Increment tag usage counts
    await tx.tag.updateMany({
      where: { id: { in: tags.map((t) => t.id) } },
      data:  { usageCount: { increment: 1 } },
    });

    // Increment author's post count
    await tx.profile.update({
      where: { userId: authorId },
      data:  { postCount: { increment: 1 }, reputationPoints: { increment: 5 } },
    });

    return created;
  });

  return normalizeTags(applyAnonymity(post, authorId, null));
}

// ─────────────────────────────────────────────────────────────
// getPostById
// ─────────────────────────────────────────────────────────────
async function getPostById(postId, requestingUserId, requestingRole) {
  const post = await prisma.post.findFirst({
    where:  { id: postId, deletedAt: null, status: { in: ['ACTIVE', 'ARCHIVED'] } },
    select: POST_SELECT,
  });

  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND, 'POST_NOT_FOUND');

  // Async view count via Redis (batch flush avoids per-request DB write)
  incrementViewCount(postId).catch(() => {});

  // Include user's vote if logged in
  let userVote = null;
  if (requestingUserId) {
    const vote = await prisma.vote.findUnique({
      where: { userId_postId: { userId: requestingUserId, postId } },
      select: { voteType: true },
    });
    userVote = vote?.voteType ?? null;
  }

  return {
    ...normalizeTags(applyAnonymity(post, requestingUserId, requestingRole)),
    userVote,
  };
}

// ─────────────────────────────────────────────────────────────
// getPostBySlug
// ─────────────────────────────────────────────────────────────
async function getPostBySlug(slug, requestingUserId, requestingRole) {
  const post = await prisma.post.findFirst({
    where:  { slug, deletedAt: null, status: { in: ['ACTIVE', 'ARCHIVED'] } },
    select: POST_SELECT,
  });

  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND, 'POST_NOT_FOUND');

  incrementViewCount(post.id).catch(() => {});

  let userVote = null;
  if (requestingUserId) {
    const vote = await prisma.vote.findUnique({
      where: { userId_postId: { userId: requestingUserId, postId: post.id } },
      select: { voteType: true },
    });
    userVote = vote?.voteType ?? null;
  }

  return {
    ...normalizeTags(applyAnonymity(post, requestingUserId, requestingRole)),
    userVote,
  };
}

// ─────────────────────────────────────────────────────────────
// getPosts — paginated feed with sorting/filtering
// ─────────────────────────────────────────────────────────────
async function getPosts({ page, limit, search, tag, sort, author, solved, requestingUserId, requestingRole }) {
  const skip = (page - 1) * limit;

  const where = {
    deletedAt: null,
    status:    'ACTIVE',
    ...(author !== undefined && { authorId: author }),
    ...(solved !== undefined && { isSolved: solved }),
  };

  if (tag) {
    where.tags = { some: { tag: { slug: tag } } };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { body:  { contains: search, mode: 'insensitive' } },
    ];
  }

  const orderByMap = {
    trending:   { trendingScore: 'desc' },
    latest:     { createdAt: 'desc' },
    top:        { upvoteCount: 'desc' },
    unanswered: { createdAt: 'desc' },
  };

  if (sort === 'unanswered') {
    where.commentCount = 0;
    where.isSolved     = false;
  }

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      select:  POST_SELECT,
      orderBy: [{ isPinned: 'desc' }, orderByMap[sort] ?? orderByMap.trending],
      skip,
      take:    limit,
    }),
    prisma.post.count({ where }),
  ]);

  const data       = posts.map((p) => normalizeTags(applyAnonymity(p, requestingUserId, requestingRole)));
  const pagination = buildPaginationMeta({ total, page, limit, data });

  return { posts: data, pagination };
}

// ─────────────────────────────────────────────────────────────
// updatePost
// ─────────────────────────────────────────────────────────────
async function updatePost(postId, userId, role, { title, body, isAnonymous, tagSlugs }) {
  const post = await prisma.post.findFirst({
    where:  { id: postId, deletedAt: null },
    select: { id: true, authorId: true, status: true, tags: { select: { tagId: true } }, createdAt: true, upvoteCount: true, downvoteCount: true, commentCount: true },
  });

  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND);

  const isOwner = post.authorId === userId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);
  if (!isOwner && !isAdmin) throw new AppError('You do not have permission to edit this post', HTTP.FORBIDDEN);
  if (post.status === 'REMOVED') throw new AppError('Removed posts cannot be edited', HTTP.FORBIDDEN);

  const updateData = {
    ...(title       !== undefined && { title }),
    ...(body        !== undefined && { body }),
    ...(isAnonymous !== undefined && { isAnonymous }),
    editedAt: new Date(),
  };

  if (tagSlugs?.length) {
    const newTags = await prisma.tag.findMany({ where: { slug: { in: tagSlugs } }, select: { id: true } });
    if (!newTags.length) throw new AppError('No valid tags provided', HTTP.BAD_REQUEST, 'INVALID_TAGS');

    // Decrement old tag counts, increment new
    const oldTagIds = post.tags.map((t) => t.tagId);
    await prisma.$transaction([
      prisma.postTag.deleteMany({ where: { postId } }),
      prisma.postTag.createMany({ data: newTags.map((t) => ({ postId, tagId: t.id })) }),
      prisma.tag.updateMany({ where: { id: { in: oldTagIds } }, data: { usageCount: { decrement: 1 } } }),
      prisma.tag.updateMany({ where: { id: { in: newTags.map((t) => t.id) } }, data: { usageCount: { increment: 1 } } }),
    ]);
  }

  // Recompute trending after edit
  if (title || body) {
    updateData.trendingScore = computeTrendingScore(
      post.upvoteCount, post.downvoteCount, post.commentCount, post.createdAt,
    );
  }

  const updated = await prisma.post.update({
    where:  { id: postId },
    data:   updateData,
    select: POST_SELECT,
  });

  return normalizeTags(updated);
}

// ─────────────────────────────────────────────────────────────
// deletePost — soft delete
// ─────────────────────────────────────────────────────────────
async function deletePost(postId, userId, role) {
  const post = await prisma.post.findFirst({
    where:  { id: postId, deletedAt: null },
    select: { id: true, authorId: true, tags: { select: { tagId: true } } },
  });

  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND);

  const isOwner = post.authorId === userId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(role);
  if (!isOwner && !isAdmin) throw new AppError('You do not have permission to delete this post', HTTP.FORBIDDEN);

  await prisma.$transaction([
    prisma.post.update({ where: { id: postId }, data: { deletedAt: new Date(), status: 'ARCHIVED' } }),
    prisma.tag.updateMany({ where: { id: { in: post.tags.map((t) => t.tagId) } }, data: { usageCount: { decrement: 1 } } }),
    prisma.profile.update({ where: { userId }, data: { postCount: { decrement: 1 } } }),
  ]);

  return { deleted: true };
}

// ─────────────────────────────────────────────────────────────
// markSolved — post author marks a comment as best answer
// ─────────────────────────────────────────────────────────────
async function markSolved(postId, userId, commentId) {
  const post = await prisma.post.findFirst({
    where:  { id: postId, deletedAt: null },
    select: { id: true, authorId: true, isSolved: true },
  });

  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND);
  if (post.authorId !== userId) throw new AppError('Only the post author can mark a solution', HTTP.FORBIDDEN);

  const comment = await prisma.comment.findFirst({
    where:  { id: commentId, postId, deletedAt: null },
    select: { id: true, authorId: true },
  });

  if (!comment) throw new AppError('Comment not found on this post', HTTP.NOT_FOUND);

  await prisma.$transaction(async (tx) => {
    // Clear any previous best-answer flag
    await tx.comment.updateMany({ where: { postId, isBestAnswer: true }, data: { isBestAnswer: false } });

    await tx.comment.update({ where: { id: commentId }, data: { isBestAnswer: true } });

    await tx.post.update({
      where: { id: postId },
      data:  { isSolved: true, solvedCommentId: commentId },
    });

    // Award reputation to the answer author
    await tx.profile.update({
      where: { userId: comment.authorId },
      data:  { reputationPoints: { increment: 15 }, answerCount: { increment: 1 } },
    });
  });

  return { solved: true, solvedCommentId: commentId };
}

// ─────────────────────────────────────────────────────────────
// getTrendingTags — for sidebar/explore
// ─────────────────────────────────────────────────────────────
async function getTrendingTags(limit = 15) {
  const redis = getRedisClient();
  const cacheKey = 'cache:trending-tags';
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached);

  const tags = await prisma.tag.findMany({
    orderBy: { usageCount: 'desc' },
    take: limit,
    select: { id: true, name: true, slug: true, color: true, usageCount: true },
  });

  await redis.setex(cacheKey, 300, JSON.stringify(tags)).catch(() => {}); // 5 min cache
  return tags;
}

// ─────────────────────────────────────────────────────────────
// View-count batching via Redis
// ─────────────────────────────────────────────────────────────
async function incrementViewCount(postId) {
  const redis = getRedisClient();
  const key   = RedisKeys.postViews(postId);
  await redis.incr(key);
  await redis.expire(key, TTL.POST_VIEWS);
}

// Called by a cron/scheduler to flush view counts to DB
async function flushViewCounts() {
  const redis = getRedisClient();
  const keys  = await redis.keys('views:post:*');

  for (const key of keys) {
    const postId = key.split(':')[2];
    const count  = await redis.getdel(key);
    if (count && parseInt(count, 10) > 0) {
      await prisma.post.update({
        where: { id: postId },
        data:  { viewCount: { increment: parseInt(count, 10) } },
      }).catch((err) => logger.warn(`View count flush failed for ${postId}: ${err.message}`));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// refreshTrendingScores — meant to be run on a schedule
// ─────────────────────────────────────────────────────────────
async function refreshTrendingScores() {
  const posts = await prisma.post.findMany({
    where:  { deletedAt: null, status: 'ACTIVE' },
    select: { id: true, upvoteCount: true, downvoteCount: true, commentCount: true, createdAt: true },
  });

  const updates = posts.map((p) =>
    prisma.post.update({
      where: { id: p.id },
      data:  { trendingScore: computeTrendingScore(p.upvoteCount, p.downvoteCount, p.commentCount, p.createdAt) },
    }),
  );

  await prisma.$transaction(updates);
  logger.info(`Refreshed trending scores for ${posts.length} posts`);
}

module.exports = {
  createPost,
  getPostById,
  getPostBySlug,
  getPosts,
  updatePost,
  deletePost,
  markSolved,
  getTrendingTags,
  incrementViewCount,
  flushViewCounts,
  refreshTrendingScores,
};
