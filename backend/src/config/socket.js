// src/config/socket.js — Socket.IO server factory

const { Server } = require('socket.io');
const { logger } = require('../utils/logger');

let io = null;

/**
 * Initialise Socket.IO on the HTTP server.
 * Called once from server.js.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.FRONTEND_URL ?? 'http://localhost:3000',
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:  60000,
    pingInterval: 25000,
    transports:   ['websocket', 'polling'],
    // Namespace-level connection limits can be added via middleware
  });

  logger.info('Socket.IO initialized');
  return io;
}

/**
 * Return the singleton io instance (throws if not yet initialised)
 */
function getIO() {
  if (!io) throw new Error('Socket.IO has not been initialized. Call initSocket() first.');
  return io;
}

// ─── Event name constants — single source of truth ───────────
const SOCKET_EVENTS = Object.freeze({
  // Connection lifecycle
  CONNECT:           'connect',
  DISCONNECT:        'disconnect',
  ERROR:             'error',

  // Online presence
  USER_ONLINE:       'user:online',
  USER_OFFLINE:      'user:offline',
  ONLINE_USERS:      'users:online',

  // Chat
  JOIN_CHAT:         'chat:join',
  LEAVE_CHAT:        'chat:leave',
  SEND_MESSAGE:      'chat:message:send',
  NEW_MESSAGE:       'chat:message:new',
  MESSAGE_SEEN:      'chat:message:seen',
  MESSAGE_DELIVERED: 'chat:message:delivered',
  MESSAGE_DELETED:   'chat:message:deleted',
  TYPING_START:      'chat:typing:start',
  TYPING_STOP:       'chat:typing:stop',

  // Notifications
  NEW_NOTIFICATION:  'notification:new',
  MARK_READ:         'notification:read',

  // Rooms
  JOIN_ROOM:         'room:join',
  LEAVE_ROOM:        'room:leave',
});

// ─── Room name helpers ────────────────────────────────────────
const SocketRooms = Object.freeze({
  user:         (userId) => `user:${userId}`,
  chat:         (chatId) => `chat:${chatId}`,
  postComments: (postId) => `post:${postId}`,
});

module.exports = { initSocket, getIO, SOCKET_EVENTS, SocketRooms };
