// src/routes/notification.routes.js

const { Router }       = require('express');
const controller       = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');
const { validateParams } = require('../middleware/validation');
const { z }            = require('zod');

const uuidParam = z.object({ id: z.string().uuid('Invalid notification ID') });

const router = Router();

// All notification routes require authentication
router.use(authenticate);

/**
 * GET /notifications
 * ?unread=true to filter to unread only
 * ?page=1&limit=20
 */
router.get('/',                    controller.getNotifications);

/**
 * GET /notifications/unread-count
 * Lightweight polling endpoint — returns { unreadCount: N }
 */
router.get('/unread-count',        controller.getUnreadCount);

/**
 * PATCH /notifications/read-all
 * Bulk mark-all-read — must be before /:id routes
 */
router.patch('/read-all',          controller.markAllRead);

/**
 * PATCH /notifications/:id/read
 */
router.patch(
  '/:id/read',
  validateParams(uuidParam),
  controller.markRead,
);

/**
 * DELETE /notifications/:id
 */
router.delete(
  '/:id',
  validateParams(uuidParam),
  controller.deleteNotification,
);

module.exports = router;
