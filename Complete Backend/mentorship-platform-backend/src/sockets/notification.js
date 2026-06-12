// src/sockets/notification.js
// Real-time notification delivery via Socket.IO user rooms.
// The heavy lifting (creating DB records) lives in notification.service.js;
// this file only handles socket-layer concerns.

const { getIO, SOCKET_EVENTS, SocketRooms } = require('../config/socket');
const { logger } = require('../utils/logger');

/**
 * Register notification-related socket event handlers.
 * Currently only handles the client-side "mark as read" event via socket.
 * All notification creation is done server-side through notificationService.
 */
function registerNotificationHandlers(io) {
  io.on('connection', (socket) => {
    const userId = socket.userId;

    // Client tells server it has seen a notification (alternative to REST PATCH)
    socket.on(SOCKET_EVENTS.MARK_READ, async ({ notificationId }) => {
      try {
        if (!notificationId) return;
        // Delegate to the service — avoid circular require by lazy-loading
        const notifService = require('../services/notification.service');
        await notifService.markRead(userId, notificationId);
      } catch (err) {
        logger.error(`Mark-read socket error: ${err.message}`);
      }
    });
  });

  logger.info('Notification socket handlers registered');
}

/**
 * Push a notification object to a user's personal room.
 * Called by notification.service.js after persisting to DB.
 *
 * @param {string} recipientId
 * @param {object} notification — the persisted Prisma notification record
 */
function emitNotification(recipientId, notification) {
  try {
    const io = getIO();
    io.to(SocketRooms.user(recipientId)).emit(SOCKET_EVENTS.NEW_NOTIFICATION, notification);
  } catch (err) {
    // getIO() throws if socket not yet ready (e.g., during tests)
    logger.warn(`emitNotification skipped: ${err.message}`);
  }
}

module.exports = { registerNotificationHandlers, emitNotification };
