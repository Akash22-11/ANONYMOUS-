// src/services/notification.service.js

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');
const { logger }   = require('../utils/logger');

const NOTIF_SELECT = {
  id: true, type: true, title: true, body: true,
  isRead: true, readAt: true, entityType: true, entityId: true,
  metadata: true, createdAt: true,
  sender: { select: { id: true, username: true, anonymousAlias: true } },
};

// ─────────────────────────────────────────────────────────────
// createNotification — internal use by services + sockets
// ─────────────────────────────────────────────────────────────
async function createNotification({
  recipientId, senderId = null, type, title, body,
  entityType = null, entityId = null, metadata = null,
}) {
  // Never notify yourself
  if (recipientId === senderId) return null;

  try {
    const notif = await prisma.notification.create({
      data: { recipientId, senderId, type, title, body, entityType, entityId, metadata },
      select: NOTIF_SELECT,
    });

    // Push real-time via socket (lazy require avoids circular dependency)
    try {
      const { emitNotification } = require('../sockets/notification');
      emitNotification(recipientId, notif);
    } catch { /* socket not running in tests */ }

    return notif;
  } catch (err) {
    // Notification failures must never crash the calling request
    logger.error(`createNotification failed: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Convenience factories — one per notification type
// ─────────────────────────────────────────────────────────────

async function notifyMention(recipientId, senderId, { postId, postTitle }) {
  return createNotification({
    recipientId, senderId,
    type: 'MENTION', title: 'You were mentioned',
    body: `Someone mentioned you in "${postTitle}"`,
    entityType: 'post', entityId: postId,
    metadata: { postTitle },
  });
}

async function notifyReply(recipientId, senderId, { postId, commentId }) {
  return createNotification({
    recipientId, senderId,
    type: 'REPLY', title: 'New reply to your comment',
    body: 'Someone replied to your comment',
    entityType: 'comment', entityId: commentId,
    metadata: { postId },
  });
}

async function notifyUpvote(recipientId, senderId, { entityType, entityId }) {
  return createNotification({
    recipientId, senderId,
    type: 'UPVOTE', title: 'Your content was upvoted',
    body: `Someone upvoted your ${entityType}`,
    entityType, entityId,
  });
}

async function notifyNewComment(recipientId, senderId, { postId, postTitle }) {
  return createNotification({
    recipientId, senderId,
    type: 'COMMENT', title: 'New comment on your post',
    body: `Someone commented on "${postTitle}"`,
    entityType: 'post', entityId: postId,
    metadata: { postTitle },
  });
}

async function notifyMentorRequest(recipientId, senderId, { requestId, topic }) {
  return createNotification({
    recipientId, senderId,
    type: 'MENTOR_REQUEST', title: 'New mentorship request',
    body: `You have a new mentorship request: "${topic}"`,
    entityType: 'mentor_request', entityId: requestId,
    metadata: { topic },
  });
}

async function notifyMentorAccepted(recipientId, senderId, { requestId, mentorAlias }) {
  return createNotification({
    recipientId, senderId,
    type: 'MENTOR_ACCEPTED', title: 'Mentorship request accepted! 🎉',
    body: `${mentorAlias} accepted your mentorship request`,
    entityType: 'mentor_request', entityId: requestId,
    metadata: { mentorAlias },
  });
}

async function notifyMentorDeclined(recipientId, senderId, { requestId }) {
  return createNotification({
    recipientId, senderId,
    type: 'MENTOR_DECLINED', title: 'Mentorship request declined',
    body: 'Your mentorship request was declined',
    entityType: 'mentor_request', entityId: requestId,
  });
}

async function notifyBadgeEarned(recipientId, { badge }) {
  return createNotification({
    recipientId, senderId: null,
    type: 'BADGE_EARNED', title: 'New badge earned! 🏅',
    body: `You earned the "${badge}" badge`,
    entityType: 'badge', entityId: null,
    metadata: { badge },
  });
}

async function notifyNewFollower(recipientId, senderId, { followerAlias }) {
  return createNotification({
    recipientId, senderId,
    type: 'NEW_FOLLOWER', title: 'New follower',
    body: `${followerAlias} started following you`,
    entityType: 'user', entityId: senderId,
  });
}

// ─────────────────────────────────────────────────────────────
// getNotifications — paginated list for the authenticated user
// ─────────────────────────────────────────────────────────────
async function getNotifications(userId, { page, limit, unreadOnly }) {
  const skip  = (page - 1) * limit;
  const where = {
    recipientId: userId,
    ...(unreadOnly ? { isRead: false } : {}),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      select:  NOTIF_SELECT,
      orderBy: { createdAt: 'desc' },
      skip,
      take:    limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit, data: notifications });
  return { notifications, pagination, unreadCount };
}

// ─────────────────────────────────────────────────────────────
// markRead — single notification
// ─────────────────────────────────────────────────────────────
async function markRead(userId, notificationId) {
  const notif = await prisma.notification.findFirst({
    where: { id: notificationId, recipientId: userId },
  });
  if (!notif) throw new AppError('Notification not found', HTTP.NOT_FOUND);
  if (notif.isRead) return notif;

  return prisma.notification.update({
    where: { id: notificationId },
    data:  { isRead: true, readAt: new Date() },
    select: NOTIF_SELECT,
  });
}

// ─────────────────────────────────────────────────────────────
// markAllRead — bulk mark for a user
// ─────────────────────────────────────────────────────────────
async function markAllRead(userId) {
  const { count } = await prisma.notification.updateMany({
    where: { recipientId: userId, isRead: false },
    data:  { isRead: true, readAt: new Date() },
  });
  return { markedCount: count };
}

// ─────────────────────────────────────────────────────────────
// getUnreadCount — lightweight badge count
// ─────────────────────────────────────────────────────────────
async function getUnreadCount(userId) {
  const count = await prisma.notification.count({
    where: { recipientId: userId, isRead: false },
  });
  return { unreadCount: count };
}

// ─────────────────────────────────────────────────────────────
// deleteNotification — user removes a single notification
// ─────────────────────────────────────────────────────────────
async function deleteNotification(userId, notificationId) {
  const notif = await prisma.notification.findFirst({
    where: { id: notificationId, recipientId: userId },
  });
  if (!notif) throw new AppError('Notification not found', HTTP.NOT_FOUND);

  await prisma.notification.delete({ where: { id: notificationId } });
}

module.exports = {
  createNotification,
  notifyMention,
  notifyReply,
  notifyUpvote,
  notifyNewComment,
  notifyMentorRequest,
  notifyMentorAccepted,
  notifyMentorDeclined,
  notifyBadgeEarned,
  notifyNewFollower,
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
  deleteNotification,
};
