// src/services/admin.service.js

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');
const { revokeRefreshToken }  = require('../utils/jwt');
const { deleteFromCloudinary } = require('../utils/cloudinaryUpload');
const { logger }   = require('../utils/logger');

// ─────────────────────────────────────────────────────────────
// DASHBOARD ANALYTICS
// ─────────────────────────────────────────────────────────────
async function getAnalytics(period) {
  const since = periodToDate(period);

  const [
    totalUsers, newUsers,
    totalPosts, newPosts,
    totalComments,
    totalResources, pendingResources,
    totalReports,   pendingReports,
    totalMentorRequests, completedSessions,
    bannedUsers,
    topPosts,
    topMentors,
    usersByRole,
    postsByDay,
    reportsByReason,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
    prisma.post.count({ where: { deletedAt: null } }),
    prisma.post.count({ where: { deletedAt: null, createdAt: { gte: since } } }),
    prisma.comment.count({ where: { deletedAt: null } }),
    prisma.resource.count({ where: { deletedAt: null } }),
    prisma.resource.count({ where: { deletedAt: null, isApproved: false } }),
    prisma.report.count({}),
    prisma.report.count({ where: { status: 'PENDING' } }),
    prisma.mentorRequest.count({}),
    prisma.mentorSession.count({ where: { status: 'COMPLETED' } }),
    prisma.user.count({ where: { isBanned: true } }),

    // Top posts by upvotes in period
    prisma.post.findMany({
      where:   { deletedAt: null, createdAt: { gte: since } },
      select:  { id: true, title: true, slug: true, upvoteCount: true, commentCount: true, viewCount: true },
      orderBy: { upvoteCount: 'desc' },
      take:    5,
    }),

    // Top mentors by sessions
    prisma.mentorProfile.findMany({
      where:   { totalSessions: { gt: 0 } },
      select:  {
        id: true, totalSessions: true, avgRating: true,
        user: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
      },
      orderBy: { totalSessions: 'desc' },
      take:    5,
    }),

    // Users grouped by role
    prisma.user.groupBy({
      by: ['role'],
      _count: { id: true },
      where:  { deletedAt: null },
    }),

    // New posts per day for sparkline (last 7 days regardless of period)
    prisma.$queryRaw`
      SELECT DATE_TRUNC('day', created_at)::date AS day, COUNT(*)::int AS count
      FROM posts
      WHERE deleted_at IS NULL
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `,

    // Reports grouped by reason
    prisma.report.groupBy({
      by: ['reason'],
      _count: { id: true },
      where:  { status: 'PENDING' },
    }),
  ]);

  return {
    period,
    overview: {
      users:           { total: totalUsers,    new: newUsers },
      posts:           { total: totalPosts,    new: newPosts },
      comments:        { total: totalComments },
      resources:       { total: totalResources, pendingApproval: pendingResources },
      reports:         { total: totalReports,   pending: pendingReports },
      mentorRequests:  { total: totalMentorRequests, completed: completedSessions },
      bannedUsers,
    },
    topPosts,
    topMentors,
    usersByRole:     usersByRole.map(r => ({ role: r.role, count: r._count.id })),
    postsByDay:      postsByDay ?? [],
    reportsByReason: reportsByReason.map(r => ({ reason: r.reason, count: r._count.id })),
  };
}

// ─────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────────────────────
async function getUsers({ page, limit, role, banned, search, sortBy }) {
  const skip  = (page - 1) * limit;

  const where = { deletedAt: null };
  if (role    !== undefined) where.role    = role;
  if (banned  !== undefined) where.isBanned = banned;

  if (search) {
    where.OR = [
      { email:          { contains: search, mode: 'insensitive' } },
      { username:       { contains: search, mode: 'insensitive' } },
      { anonymousAlias: { contains: search, mode: 'insensitive' } },
      { profile: { displayName: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const orderBy = {
    newest:     { createdAt: 'desc' },
    reputation: { profile: { reputationPoints: 'desc' } },
    activity:   { lastLoginAt: 'desc' },
  }[sortBy] ?? { createdAt: 'desc' };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true, email: true, username: true, anonymousAlias: true,
        role: true, isEmailVerified: true, isActive: true,
        isBanned: true, banReason: true, bannedAt: true,
        lastLoginAt: true, createdAt: true,
        profile: { select: { displayName: true, college: true, reputationPoints: true } },
        _count: { select: { posts: true, comments: true, reports: true } },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, pagination: buildPaginationMeta({ total, page, limit, data: users }) };
}

async function getUserDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, username: true, anonymousAlias: true,
      role: true, isEmailVerified: true, isActive: true,
      isBanned: true, banReason: true, bannedAt: true, bannedBy: true,
      lastLoginAt: true, lastSeenAt: true, createdAt: true,
      profile:       true,
      mentorProfile: true,
      badges:        true,
      _count: {
        select: {
          posts: true, comments: true, resources: true,
          reports: true, mentorRequests: true,
        },
      },
    },
  });

  if (!user) throw new AppError('User not found', HTTP.NOT_FOUND);
  return user;
}

async function banUser(adminId, targetUserId, { reason, permanent }) {
  if (adminId === targetUserId) {
    throw new AppError('You cannot ban yourself', HTTP.BAD_REQUEST);
  }

  const target = await prisma.user.findFirst({
    where:  { id: targetUserId, deletedAt: null },
    select: { id: true, role: true, isBanned: true },
  });
  if (!target) throw new AppError('User not found', HTTP.NOT_FOUND);
  if (target.role === 'SUPER_ADMIN') {
    throw new AppError('Super admins cannot be banned', HTTP.FORBIDDEN);
  }
  if (target.isBanned) {
    throw new AppError('User is already banned', HTTP.CONFLICT, 'ALREADY_BANNED');
  }

  const [user] = await Promise.all([
    prisma.user.update({
      where: { id: targetUserId },
      data:  {
        isBanned:  true,
        banReason: reason,
        bannedAt:  new Date(),
        bannedBy:  adminId,
        isActive:  false,
      },
      select: { id: true, username: true, isBanned: true, banReason: true },
    }),
    // Revoke their session so they're kicked immediately
    revokeRefreshToken(targetUserId),
    // Admin audit trail
    prisma.adminAction.create({
      data: {
        adminId,
        actionType: permanent ? 'permanent_ban' : 'ban_user',
        targetType: 'user',
        targetId:   targetUserId,
        reason,
        metadata:   { permanent },
      },
    }),
  ]);

  logger.info(`User ${targetUserId} banned by admin ${adminId}: ${reason}`);
  return user;
}

async function unbanUser(adminId, targetUserId) {
  const target = await prisma.user.findFirst({
    where:  { id: targetUserId, deletedAt: null },
    select: { id: true, isBanned: true },
  });
  if (!target)          throw new AppError('User not found', HTTP.NOT_FOUND);
  if (!target.isBanned) throw new AppError('User is not banned', HTTP.CONFLICT, 'NOT_BANNED');

  const [user] = await Promise.all([
    prisma.user.update({
      where: { id: targetUserId },
      data:  { isBanned: false, banReason: null, bannedAt: null, bannedBy: null, isActive: true },
      select: { id: true, username: true, isBanned: true },
    }),
    prisma.adminAction.create({
      data: { adminId, actionType: 'unban_user', targetType: 'user', targetId: targetUserId },
    }),
  ]);

  return user;
}

async function changeUserRole(adminId, targetUserId, { role }) {
  const target = await prisma.user.findFirst({
    where:  { id: targetUserId, deletedAt: null },
    select: { id: true, role: true },
  });
  if (!target) throw new AppError('User not found', HTTP.NOT_FOUND);
  if (target.role === 'SUPER_ADMIN') {
    throw new AppError('Cannot change SUPER_ADMIN role', HTTP.FORBIDDEN);
  }

  const [user] = await Promise.all([
    prisma.user.update({
      where:  { id: targetUserId },
      data:   { role },
      select: { id: true, username: true, role: true },
    }),
    prisma.adminAction.create({
      data: {
        adminId,
        actionType: 'change_role',
        targetType: 'user',
        targetId:   targetUserId,
        metadata:   { oldRole: target.role, newRole: role },
      },
    }),
  ]);

  // If promoted to mentor, ensure a mentor profile exists
  if (role === 'MENTOR') {
    await prisma.mentorProfile.upsert({
      where:  { userId: targetUserId },
      update: {},
      create: { userId: targetUserId },
    });
  }

  return user;
}

// ─────────────────────────────────────────────────────────────
// POST MODERATION
// ─────────────────────────────────────────────────────────────
async function updatePostStatus(adminId, postId, { status, reason }) {
  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: { id: true, status: true, title: true },
  });
  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND);

  const [updated] = await Promise.all([
    prisma.post.update({
      where:  { id: postId },
      data:   { status },
      select: { id: true, title: true, status: true },
    }),
    prisma.adminAction.create({
      data: {
        adminId,
        actionType: `post_${status.toLowerCase()}`,
        targetType: 'post',
        targetId:   postId,
        reason:     reason ?? null,
        metadata:   { oldStatus: post.status, newStatus: status },
      },
    }),
  ]);

  return updated;
}

async function deletePost(adminId, postId, reason) {
  const post = await prisma.post.findFirst({
    where: { id: postId, deletedAt: null },
    select: { id: true },
  });
  if (!post) throw new AppError('Post not found', HTTP.NOT_FOUND);

  await Promise.all([
    prisma.post.update({
      where: { id: postId },
      data:  { deletedAt: new Date(), status: 'REMOVED' },
    }),
    prisma.adminAction.create({
      data: {
        adminId,
        actionType: 'delete_post',
        targetType: 'post',
        targetId:   postId,
        reason:     reason ?? 'Admin removal',
      },
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────
// MENTOR VERIFICATION
// ─────────────────────────────────────────────────────────────
async function verifyMentor(adminId, mentorProfileId, { verified, reason }) {
  const mp = await prisma.mentorProfile.findUnique({
    where: { id: mentorProfileId }, select: { id: true, verifiedMentor: true },
  });
  if (!mp) throw new AppError('Mentor profile not found', HTTP.NOT_FOUND);

  const [updated] = await Promise.all([
    prisma.mentorProfile.update({
      where:  { id: mentorProfileId },
      data:   { verifiedMentor: verified },
      select: { id: true, verifiedMentor: true,
        user: { select: { id: true, username: true } } },
    }),
    prisma.adminAction.create({
      data: {
        adminId,
        actionType: verified ? 'verify_mentor' : 'unverify_mentor',
        targetType: 'mentor_profile',
        targetId:   mentorProfileId,
        reason:     reason ?? null,
      },
    }),
  ]);

  return updated;
}

// ─────────────────────────────────────────────────────────────
// RESOURCE MODERATION (delegates to resource.service)
// ─────────────────────────────────────────────────────────────
async function getPendingResources({ page, limit }) {
  const skip = (page - 1) * limit;

  const [resources, total] = await Promise.all([
    prisma.resource.findMany({
      where:   { isApproved: false, deletedAt: null },
      select: {
        id: true, title: true, type: true, fileUrl: true, externalUrl: true,
        college: true, department: true, createdAt: true,
        uploader: { select: { id: true, username: true, anonymousAlias: true } },
        tags: { select: { tag: { select: { name: true, slug: true } } } },
      },
      orderBy: { createdAt: 'asc' }, // oldest first (FIFO queue)
      skip,
      take: limit,
    }),
    prisma.resource.count({ where: { isApproved: false, deletedAt: null } }),
  ]);

  return { resources, pagination: buildPaginationMeta({ total, page, limit, data: resources }) };
}

// ─────────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────────
async function getAuditLog({ page, limit, adminId, actionType }) {
  const skip  = (page - 1) * limit;
  const where = {
    ...(adminId    ? { adminId }    : {}),
    ...(actionType ? { actionType } : {}),
  };

  const [actions, total] = await Promise.all([
    prisma.adminAction.findMany({
      where,
      select: {
        id: true, actionType: true, targetType: true, targetId: true,
        reason: true, metadata: true, createdAt: true,
        admin: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.adminAction.count({ where }),
  ]);

  return { actions, pagination: buildPaginationMeta({ total, page, limit, data: actions }) };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function periodToDate(period) {
  const map = { '7d': 7, '30d': 30, '90d': 90 };
  const days = map[period];
  if (!days) return new Date(0); // 'all'
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

module.exports = {
  getAnalytics,
  getUsers,
  getUserDetail,
  banUser,
  unbanUser,
  changeUserRole,
  updatePostStatus,
  deletePost,
  verifyMentor,
  getPendingResources,
  getAuditLog,
};
