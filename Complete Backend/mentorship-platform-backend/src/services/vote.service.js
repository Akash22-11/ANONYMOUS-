// src/services/vote.service.js — Upvote / downvote business logic

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { getIO, SocketRooms, SOCKET_EVENTS } = require('../config/socket');

// ─────────────────────────────────────────────────────────────
// castVote — idempotent upsert:
//   • first call        → creates vote
//   • same voteType     → removes vote (toggle off)
//   • different voteType → switches vote
// ─────────────────────────────────────────────────────────────
async function castVote(userId, { targetType, targetId, voteType }) {
  // 1. Resolve target entity
  let target, authorId;

  if (targetType === 'post') {
    target = await prisma.post.findFirst({
      where:  { id: targetId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, authorId: true, upvoteCount: true, downvoteCount: true },
    });
    if (!target) throw new AppError('Post not found', HTTP.NOT_FOUND);
    authorId = target.authorId;
  } else {
    target = await prisma.comment.findFirst({
      where:  { id: targetId, deletedAt: null },
      select: { id: true, authorId: true, upvoteCount: true, downvoteCount: true },
    });
    if (!target) throw new AppError('Comment not found', HTTP.NOT_FOUND);
    authorId = target.authorId;
  }

  // 2. Cannot vote on your own content
  if (authorId === userId) {
    throw new AppError('You cannot vote on your own content', HTTP.BAD_REQUEST, 'SELF_VOTE');
  }

  // 3. Find existing vote
  const where = targetType === 'post'
    ? { userId_postId:    { userId, postId:    targetId } }
    : { userId_commentId: { userId, commentId: targetId } };

  const existing = await prisma.vote.findUnique({ where });

  let action; // 'created' | 'removed' | 'switched'
  let finalVoteType = voteType;

  await prisma.$transaction(async (tx) => {
    if (!existing) {
      // ── New vote ────────────────────────────────────────────
      await tx.vote.create({
        data: {
          userId,
          voteType,
          ...(targetType === 'post' ? { postId: targetId } : { commentId: targetId }),
        },
      });
      action = 'created';

    } else if (existing.voteType === voteType) {
      // ── Toggle off (same vote type → remove) ────────────────
      await tx.vote.delete({ where });
      action        = 'removed';
      finalVoteType = null;

    } else {
      // ── Switch vote direction ───────────────────────────────
      await tx.vote.update({ where, data: { voteType } });
      action = 'switched';
    }

    // ── Update denormalized counts ──────────────────────────
    const countDelta = buildCountDelta(existing?.voteType ?? null, finalVoteType, action);

    if (targetType === 'post') {
      await tx.post.update({
        where: { id: targetId },
        data:  countDelta,
      });
    } else {
      await tx.comment.update({
        where: { id: targetId },
        data:  countDelta,
      });
    }

    // ── Reputation: award to content author ─────────────────
    const repDelta = computeRepDelta(existing?.voteType ?? null, finalVoteType, action);
    if (repDelta !== 0) {
      await tx.profile.update({
        where: { userId: authorId },
        data:  { reputationPoints: { increment: repDelta } },
      });
    }
  });

  // 4. Emit real-time vote update to the post's comment room
  try {
    const io = getIO();
    const room = targetType === 'post'
      ? SocketRooms.postComments(targetId)
      : SocketRooms.postComments(target.postId ?? targetId);
    io.to(room).emit(SOCKET_EVENTS.NEW_NOTIFICATION, {
      type: 'VOTE_UPDATE', targetType, targetId, voteType: finalVoteType, action,
    });
  } catch { /* socket not yet initialised in tests */ }

  // 5. Fetch fresh counts to return
  const updated = targetType === 'post'
    ? await prisma.post.findUnique({ where: { id: targetId }, select: { upvoteCount: true, downvoteCount: true } })
    : await prisma.comment.findUnique({ where: { id: targetId }, select: { upvoteCount: true, downvoteCount: true } });

  return {
    action,
    voteType:     finalVoteType,
    upvoteCount:  updated.upvoteCount,
    downvoteCount: updated.downvoteCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────

function buildCountDelta(prevVote, nextVote, action) {
  const delta = { upvoteCount: 0, downvoteCount: 0 };

  if (action === 'created') {
    if (nextVote === 'UPVOTE')   delta.upvoteCount   = { increment: 1 };
    if (nextVote === 'DOWNVOTE') delta.downvoteCount  = { increment: 1 };
  } else if (action === 'removed') {
    if (prevVote === 'UPVOTE')   delta.upvoteCount   = { decrement: 1 };
    if (prevVote === 'DOWNVOTE') delta.downvoteCount  = { decrement: 1 };
  } else if (action === 'switched') {
    if (nextVote === 'UPVOTE')   { delta.upvoteCount = { increment: 1 }; delta.downvoteCount = { decrement: 1 }; }
    if (nextVote === 'DOWNVOTE') { delta.downvoteCount = { increment: 1 }; delta.upvoteCount = { decrement: 1 }; }
  }

  // Remove zero-delta keys so Prisma doesn't reject them
  return Object.fromEntries(Object.entries(delta).filter(([, v]) => v !== 0));
}

function computeRepDelta(prevVote, nextVote, action) {
  // Reputation points per event
  const REP = { UPVOTE: 10, DOWNVOTE: -2 };

  if (action === 'created')  return REP[nextVote] ?? 0;
  if (action === 'removed')  return -(REP[prevVote] ?? 0);
  if (action === 'switched') return (REP[nextVote] ?? 0) - (REP[prevVote] ?? 0);
  return 0;
}

// ─────────────────────────────────────────────────────────────
// getUserVotes — which posts/comments the user has voted on
// (used by frontend to show correct vote state)
// ─────────────────────────────────────────────────────────────
async function getUserVotes(userId, { postIds = [], commentIds = [] }) {
  const votes = await prisma.vote.findMany({
    where: {
      userId,
      OR: [
        ...(postIds.length    ? [{ postId:    { in: postIds    } }] : []),
        ...(commentIds.length ? [{ commentId: { in: commentIds } }] : []),
      ],
    },
    select: { postId: true, commentId: true, voteType: true },
  });

  // Build lookup maps for O(1) access
  const postVotes    = {};
  const commentVotes = {};
  for (const v of votes) {
    if (v.postId)    postVotes[v.postId]       = v.voteType;
    if (v.commentId) commentVotes[v.commentId] = v.voteType;
  }
  return { postVotes, commentVotes };
}

module.exports = { castVote, getUserVotes };
