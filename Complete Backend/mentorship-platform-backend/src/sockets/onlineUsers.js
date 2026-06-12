// src/sockets/onlineUsers.js
// Tracks which users are currently connected and broadcasts presence events.
// Uses a Redis Set so multiple server instances stay in sync.

const { getRedisClient, RedisKeys } = require('../config/redis');
const { verifyAccessToken, extractBearerToken } = require('../utils/jwt');
const { SOCKET_EVENTS, SocketRooms }  = require('../config/socket');
const { logger } = require('../utils/logger');

// In-process map: socketId -> userId  (for quick cleanup on disconnect)
const socketToUser = new Map();

/**
 * Attach online-presence middleware + handlers to the io instance.
 * Called once from server.js after initSocket().
 */
function registerOnlineUserHandlers(io) {
  // ── Socket-level auth middleware ─────────────────────────────
  // Every connecting socket must supply a valid JWT via handshake.
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ??
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('AUTH_REQUIRED'));

      const decoded = verifyAccessToken(token);
      socket.userId    = decoded.sub;
      socket.userRole  = decoded.role;
      socket.userAlias = decoded.alias;
      return next();
    } catch {
      return next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    logger.info(`Socket connected: ${socket.id} — user:${userId}`);

    // ── 1. Track in Redis + local map ──────────────────────────
    socketToUser.set(socket.id, userId);
    try {
      const redis = getRedisClient();
      await redis.sadd(RedisKeys.onlineUsers(), userId);
      await redis.setex(RedisKeys.userSession(userId), 300, socket.id); // 5-min TTL refreshed on ping
    } catch (err) {
      logger.error(`Redis presence error: ${err.message}`);
    }

    // ── 2. Join personal notification room ─────────────────────
    socket.join(SocketRooms.user(userId));

    // ── 3. Broadcast to everyone that this user is online ──────
    socket.broadcast.emit(SOCKET_EVENTS.USER_ONLINE, {
      userId,
      alias: socket.userAlias,
      ts:    Date.now(),
    });

    // ── 4. Send current online list back to the joining client ─
    try {
      const redis    = getRedisClient();
      const onlineIds = await redis.smembers(RedisKeys.onlineUsers());
      socket.emit(SOCKET_EVENTS.ONLINE_USERS, { userIds: onlineIds });
    } catch { /* non-fatal */ }

    // ── 5. Heartbeat — refresh TTL every 60s ───────────────────
    const heartbeat = setInterval(async () => {
      try {
        const redis = getRedisClient();
        await redis.expire(RedisKeys.userSession(userId), 300);
      } catch { /* ignore */ }
    }, 60_000);

    // ── 6. Disconnect cleanup ───────────────────────────────────
    socket.on('disconnect', async (reason) => {
      clearInterval(heartbeat);
      socketToUser.delete(socket.id);
      logger.info(`Socket disconnected: ${socket.id} — user:${userId} reason:${reason}`);

      // Only mark offline if this was the user's LAST socket
      const remainingSockets = [...io.sockets.sockets.values()]
        .filter(s => s.userId === userId && s.id !== socket.id);

      if (remainingSockets.length === 0) {
        try {
          const redis = getRedisClient();
          await redis.srem(RedisKeys.onlineUsers(), userId);
          await redis.del(RedisKeys.userSession(userId));
        } catch { /* ignore */ }

        io.emit(SOCKET_EVENTS.USER_OFFLINE, { userId, ts: Date.now() });
      }
    });
  });

  logger.info('Online-presence handlers registered');
}

/**
 * Check if a user is currently online (used by other services)
 */
async function isUserOnline(userId) {
  try {
    const redis = getRedisClient();
    return (await redis.sismember(RedisKeys.onlineUsers(), userId)) === 1;
  } catch {
    return false;
  }
}

/**
 * Get the full set of online user IDs
 */
async function getOnlineUserIds() {
  try {
    const redis = getRedisClient();
    return await redis.smembers(RedisKeys.onlineUsers());
  } catch {
    return [];
  }
}

module.exports = { registerOnlineUserHandlers, isUserOnline, getOnlineUserIds };
