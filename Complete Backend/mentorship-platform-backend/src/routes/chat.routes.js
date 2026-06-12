// src/routes/chat.routes.js

const { Router }       = require('express');
const controller       = require('../controllers/chat.controller');
const { authenticate, requireEmailVerified } = require('../middleware/auth');
const { validateBody, validateParams }       = require('../middleware/validation');
const { RateLimiters } = require('../middleware/rateLimit');
const { z }            = require('zod');

const chatIdParam = z.object({ id: z.string().uuid('Invalid chat ID') });
const msgParams   = z.object({
  id:        z.string().uuid('Invalid chat ID'),
  messageId: z.string().uuid('Invalid message ID'),
});

const router = Router();

// All chat routes require a verified, authenticated user
router.use(authenticate);
router.use(requireEmailVerified);

/**
 * GET /chats
 * All conversations for the current user, sorted by latest message
 */
router.get('/', controller.getUserChats);

/**
 * POST /chats/direct
 * Open (or retrieve) a DM with another user
 * body: { userId: uuid }
 */
router.post(
  '/direct',
  validateBody(z.object({ userId: z.string().uuid('Invalid user ID') })),
  controller.getOrCreateDirect,
);

/**
 * GET /chats/:id
 * Chat room details + participant list
 */
router.get(
  '/:id',
  validateParams(chatIdParam),
  controller.getChatById,
);

/**
 * GET /chats/:id/messages
 * Cursor-paginated message history
 * ?limit=30&cursor=<messageId>
 */
router.get(
  '/:id/messages',
  validateParams(chatIdParam),
  controller.getMessages,
);

/**
 * POST /chats/:id/messages
 * REST alternative to the socket send-message event
 */
router.post(
  '/:id/messages',
  validateParams(chatIdParam),
  RateLimiters.chatMessage,
  validateBody(
    z.object({
      body:      z.string().trim().max(4000).optional(),
      replyToId: z.string().uuid().optional(),
      mediaUrl:  z.string().url().optional(),
      mediaType: z.string().max(50).optional(),
    }).refine(
      (d) => d.body || d.mediaUrl,
      { message: 'body or mediaUrl is required' },
    ),
  ),
  controller.sendMessage,
);

/**
 * PATCH /chats/:id/messages/:messageId
 * Edit a message (15-minute window)
 */
router.patch(
  '/:id/messages/:messageId',
  validateParams(msgParams),
  validateBody(z.object({ body: z.string().trim().min(1).max(4000) })),
  controller.editMessage,
);

/**
 * DELETE /chats/:id/messages/:messageId
 * Soft-delete a message
 */
router.delete(
  '/:id/messages/:messageId',
  validateParams(msgParams),
  controller.deleteMessage,
);

module.exports = router;
