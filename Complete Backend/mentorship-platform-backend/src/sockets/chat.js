// src/sockets/chat.js
// Real-time chat: join/leave rooms, send messages, typing indicators, seen receipts.

const { SOCKET_EVENTS, SocketRooms } = require('../config/socket');
const { getRedisClient, RedisKeys, TTL } = require('../config/redis');
const { logger } = require('../utils/logger');

/**
 * Register all chat-related socket event handlers.
 * Called once from server.js after initSocket().
 */
function registerChatHandlers(io) {
  io.on('connection', (socket) => {
    const userId = socket.userId;

    // ── join a chat room ──────────────────────────────────────
    // Client calls this after opening a conversation.
    socket.on(SOCKET_EVENTS.JOIN_CHAT, async ({ chatId }) => {
      if (!chatId) return;

      try {
        // Verify the user is actually a participant before joining
        const chatService = require('../services/chat.service');
        const isMember = await chatService.isParticipant(chatId, userId);
        if (!isMember) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'Not a participant in this chat' });
          return;
        }

        socket.join(SocketRooms.chat(chatId));
        logger.info(`User ${userId} joined chat room ${chatId}`);

        // Mark all unread messages as delivered now that the user is present
        await chatService.markDelivered(chatId, userId);

        // Notify others in the room that this user is active
        socket.to(SocketRooms.chat(chatId)).emit('chat:participant:online', {
          chatId, userId, ts: Date.now(),
        });
      } catch (err) {
        logger.error(`JOIN_CHAT error: ${err.message}`);
      }
    });

    // ── leave a chat room ─────────────────────────────────────
    socket.on(SOCKET_EVENTS.LEAVE_CHAT, ({ chatId }) => {
      if (!chatId) return;
      socket.leave(SocketRooms.chat(chatId));
      socket.to(SocketRooms.chat(chatId)).emit('chat:participant:offline', {
        chatId, userId, ts: Date.now(),
      });
    });

    // ── send a message ────────────────────────────────────────
    // Validation + DB write is done here; the REST endpoint is an alternative path.
    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (payload) => {
      const { chatId, body, replyToId, mediaUrl, mediaType } = payload ?? {};

      if (!chatId || (!body && !mediaUrl)) {
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'chatId and body or mediaUrl required' });
        return;
      }

      try {
        const chatService = require('../services/chat.service');

        // Auth check — must be a participant
        const isMember = await chatService.isParticipant(chatId, userId);
        if (!isMember) {
          socket.emit(SOCKET_EVENTS.ERROR, { message: 'Not a participant in this chat' });
          return;
        }

        const message = await chatService.createMessage(chatId, userId, {
          body:      body?.trim() ?? null,
          replyToId: replyToId ?? null,
          mediaUrl:  mediaUrl  ?? null,
          mediaType: mediaType ?? null,
        });

        // Broadcast to everyone in the chat room (including sender)
        io.to(SocketRooms.chat(chatId)).emit(SOCKET_EVENTS.NEW_MESSAGE, message);

        // Push notification to offline participants via their personal rooms
        const participants = await chatService.getParticipantIds(chatId);
        for (const participantId of participants) {
          if (participantId !== userId) {
            io.to(SocketRooms.user(participantId)).emit(SOCKET_EVENTS.NEW_MESSAGE, {
              ...message,
              _notification: true, // hint to client: came via personal room
            });
          }
        }
      } catch (err) {
        logger.error(`SEND_MESSAGE error: ${err.message}`);
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Failed to send message' });
      }
    });

    // ── seen receipt ──────────────────────────────────────────
    socket.on(SOCKET_EVENTS.MESSAGE_SEEN, async ({ chatId, messageId }) => {
      if (!chatId || !messageId) return;

      try {
        const chatService = require('../services/chat.service');
        await chatService.markMessageRead(chatId, userId, messageId);

        // Notify other participants that their message was read
        socket.to(SocketRooms.chat(chatId)).emit(SOCKET_EVENTS.MESSAGE_SEEN, {
          chatId, messageId, seenBy: userId, ts: Date.now(),
        });
      } catch (err) {
        logger.error(`MESSAGE_SEEN error: ${err.message}`);
      }
    });

    // ── typing indicators ─────────────────────────────────────
    socket.on(SOCKET_EVENTS.TYPING_START, async ({ chatId }) => {
      if (!chatId) return;
      try {
        const redis = getRedisClient();
        await redis.setex(RedisKeys.chatTyping(chatId), TTL.TYPING_INDICATOR, userId);
        socket.to(SocketRooms.chat(chatId)).emit(SOCKET_EVENTS.TYPING_START, {
          chatId, userId, alias: socket.userAlias,
        });
      } catch { /* non-fatal */ }
    });

    socket.on(SOCKET_EVENTS.TYPING_STOP, async ({ chatId }) => {
      if (!chatId) return;
      try {
        const redis = getRedisClient();
        await redis.del(RedisKeys.chatTyping(chatId));
        socket.to(SocketRooms.chat(chatId)).emit(SOCKET_EVENTS.TYPING_STOP, {
          chatId, userId,
        });
      } catch { /* non-fatal */ }
    });

    // ── cleanup on disconnect ─────────────────────────────────
    socket.on('disconnect', () => {
      // Clear any typing indicators the user left behind
      // (rooms are auto-left by Socket.IO on disconnect)
    });
  });

  logger.info('Chat socket handlers registered');
}

module.exports = { registerChatHandlers };
