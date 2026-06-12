// src/controllers/chat.controller.js

const chatService = require('../services/chat.service');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { getIO, SOCKET_EVENTS, SocketRooms } = require('../config/socket');

/**
 * @swagger
 * /chats:
 *   get:
 *     summary: Get all chats for the authenticated user
 *     tags: [Chat]
 */
async function getUserChats(req, res) {
  const chats = await chatService.getUserChats(req.user.id);
  return successResponse(res, { message: 'Chats fetched', data: chats });
}

/**
 * @swagger
 * /chats/direct:
 *   post:
 *     summary: Get or create a direct message chat with another user
 *     tags: [Chat]
 */
async function getOrCreateDirect(req, res) {
  const { userId } = req.body;
  if (!userId) throw new AppError('userId is required', HTTP.BAD_REQUEST);

  const { chat, created } = await chatService.getOrCreateDirectChat(req.user.id, userId);

  return created
    ? createdResponse(res, { message: 'Chat created', data: chat })
    : successResponse(res, { message: 'Chat fetched', data: chat });
}

/**
 * @swagger
 * /chats/{id}:
 *   get:
 *     summary: Get a specific chat room (must be a participant)
 *     tags: [Chat]
 */
async function getChatById(req, res) {
  const chat = await chatService.getChatById(req.params.id, req.user.id);
  return successResponse(res, { message: 'Chat fetched', data: chat });
}

/**
 * @swagger
 * /chats/{id}/messages:
 *   get:
 *     summary: Get paginated message history (cursor-based, newest first)
 *     tags: [Chat]
 */
async function getMessages(req, res) {
  const limit  = Math.min(parseInt(req.query.limit ?? '30', 10), 100);
  const cursor = req.query.cursor ?? null;

  const { messages, pagination } = await chatService.getMessages(
    req.params.id,
    req.user.id,
    { limit, cursor },
  );

  return paginatedResponse(res, { message: 'Messages fetched', data: messages, pagination });
}

/**
 * @swagger
 * /chats/{id}/messages:
 *   post:
 *     summary: Send a message via REST (alternative to socket)
 *     tags: [Chat]
 */
async function sendMessage(req, res) {
  const { body, replyToId, mediaUrl, mediaType } = req.body;

  const message = await chatService.createMessage(req.params.id, req.user.id, {
    body, replyToId, mediaUrl, mediaType,
  });

  // Broadcast via socket so all connected clients update in real-time
  try {
    const io = getIO();
    io.to(SocketRooms.chat(req.params.id)).emit(SOCKET_EVENTS.NEW_MESSAGE, message);

    // Push to offline participants' personal rooms
    const participantIds = await chatService.getParticipantIds(req.params.id);
    for (const pid of participantIds) {
      if (pid !== req.user.id) {
        io.to(SocketRooms.user(pid)).emit(SOCKET_EVENTS.NEW_MESSAGE, {
          ...message, _notification: true,
        });
      }
    }
  } catch { /* socket not running */ }

  return createdResponse(res, { message: 'Message sent', data: message });
}

/**
 * @swagger
 * /chats/{id}/messages/{messageId}:
 *   patch:
 *     summary: Edit a message (owner only, within 15-minute window)
 *     tags: [Chat]
 */
async function editMessage(req, res) {
  const { body } = req.body;
  if (!body?.trim()) throw new AppError('Message body is required', HTTP.BAD_REQUEST);

  const message = await chatService.editMessage(req.params.messageId, req.user.id, body);

  // Broadcast edit to room
  try {
    getIO().to(SocketRooms.chat(req.params.id)).emit('chat:message:edited', message);
  } catch { /* non-fatal */ }

  return successResponse(res, { message: 'Message updated', data: message });
}

/**
 * @swagger
 * /chats/{id}/messages/{messageId}:
 *   delete:
 *     summary: Delete a message (soft delete, owner only)
 *     tags: [Chat]
 */
async function deleteMessage(req, res) {
  const result = await chatService.deleteMessage(req.params.messageId, req.user.id);

  try {
    getIO().to(SocketRooms.chat(req.params.id)).emit(SOCKET_EVENTS.MESSAGE_DELETED, result);
  } catch { /* non-fatal */ }

  return successResponse(res, { message: 'Message deleted', data: result });
}

module.exports = { getUserChats, getOrCreateDirect, getChatById, getMessages, sendMessage, editMessage, deleteMessage };
