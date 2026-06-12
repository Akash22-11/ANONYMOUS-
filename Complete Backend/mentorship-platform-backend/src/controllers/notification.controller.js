// src/controllers/notification.controller.js

const notifService = require('../services/notification.service');
const { successResponse, paginatedResponse, noContentResponse } = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: Get paginated notifications for the authenticated user
 *     tags: [Notifications]
 */
async function getNotifications(req, res) {
  const { page, limit }   = parsePaginationParams(req.query);
  const unreadOnly = req.query.unread === 'true';

  const { notifications, pagination, unreadCount } =
    await notifService.getNotifications(req.user.id, { page, limit, unreadOnly });

  return paginatedResponse(res, {
    message: 'Notifications fetched',
    data:    notifications,
    pagination: { ...pagination, unreadCount },
  });
}

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Get unread notification count (lightweight badge endpoint)
 *     tags: [Notifications]
 */
async function getUnreadCount(req, res) {
  const result = await notifService.getUnreadCount(req.user.id);
  return successResponse(res, { message: 'Unread count fetched', data: result });
}

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 */
async function markRead(req, res) {
  const notif = await notifService.markRead(req.user.id, req.params.id);
  return successResponse(res, { message: 'Notification marked as read', data: notif });
}

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 */
async function markAllRead(req, res) {
  const result = await notifService.markAllRead(req.user.id);
  return successResponse(res, { message: 'All notifications marked as read', data: result });
}

/**
 * @swagger
 * /notifications/{id}:
 *   delete:
 *     summary: Delete a single notification
 *     tags: [Notifications]
 */
async function deleteNotification(req, res) {
  await notifService.deleteNotification(req.user.id, req.params.id);
  return successResponse(res, { message: 'Notification deleted' });
}

module.exports = { getNotifications, getUnreadCount, markRead, markAllRead, deleteNotification };
