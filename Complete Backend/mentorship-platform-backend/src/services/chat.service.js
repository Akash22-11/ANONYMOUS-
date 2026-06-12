// src/services/chat.service.js

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildCursorMeta } = require('../utils/pagination');
const { logger }   = require('../utils/logger');

const MESSAGE_SELECT = {
  id: true, chatId: true, body: true, mediaUrl: true, mediaType: true,
  status: true, isEdited: true, editedAt: true, isDeleted: true,
  createdAt: true, updatedAt: true,
  sender: { select: { id: true, username: true, anonymousAlias: true, profile: { select: { avatarUrl: true } } } },
  replyTo: {
    select: { id: true, body: true, isDeleted: true,
      sender: { select: { id: true, username: true, anonymousAlias: true } } },
  },
};

const CHAT_SELECT = {
  id: true, name: true, isGroup: true, createdAt: true, updatedAt: true,
  participants: {
    where:  { leftAt: null },
    select: {
      userId: true, isAdmin: true, lastReadAt: true, joinedAt: true,
      user: { select: { id: true, username: true, anonymousAlias: true,
        profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  },
};

// ─────────────────────────────────────────────────────────────
// getOrCreateDirectChat — idempotent DM room between two users
// ─────────────────────────────────────────────────────────────
async function getOrCreateDirectChat(userAId, userBId) {
  if (userAId === userBId) {
    throw new AppError('Cannot create a chat with yourself', HTTP.BAD_REQUEST);
  }

  // Find an existing non-group chat that has exactly these two participants
  const existing = await prisma.chat.findFirst({
    where: {
      isGroup: false,
      participants: { every: { userId: { in: [userAId, userBId] }, leftAt: null } },
      AND: [
        { participants: { some: { userId: userAId } } },
        { participants: { some: { userId: userBId } } },
      ],
    },
    select: CHAT_SELECT,
  });

  if (existing) return { chat: existing, created: false };

  const chat = await prisma.chat.create({
    data: {
      isGroup:      false,
      participants: {
        create: [
          { userId: userAId, isAdmin: false },
          { userId: userBId, isAdmin: false },
        ],
      },
    },
    select: CHAT_SELECT,
  });

  return { chat, created: true };
}

// ─────────────────────────────────────────────────────────────
// createMentorChat — dedicated room tied to a MentorRequest
// ─────────────────────────────────────────────────────────────
async function createMentorChat(requestId, menteeId, mentorUserId) {
  const chat = await prisma.$transaction(async (tx) => {
    const newChat = await tx.chat.create({
      data: {
        isGroup: false,
        participants: {
          create: [
            { userId: menteeId,    isAdmin: false },
            { userId: mentorUserId, isAdmin: true },
          ],
        },
      },
      select: { id: true },
    });

    // Link the request to the chat room
    await tx.mentorRequest.update({
      where: { id: requestId },
      data:  { chatRoomId: newChat.id },
    });

    return newChat;
  });

  return getChatById(chat.id, menteeId);
}

// ─────────────────────────────────────────────────────────────
// getChatById
// ─────────────────────────────────────────────────────────────
async function getChatById(chatId, requestingUserId) {
  await assertParticipant(chatId, requestingUserId);

  const chat = await prisma.chat.findUnique({
    where:  { id: chatId },
    select: CHAT_SELECT,
  });
  if (!chat) throw new AppError('Chat not found', HTTP.NOT_FOUND);
  return chat;
}

// ─────────────────────────────────────────────────────────────
// getUserChats — all chats for a user, sorted by latest message
// ─────────────────────────────────────────────────────────────
async function getUserChats(userId) {
  const participations = await prisma.chatParticipant.findMany({
    where:  { userId, leftAt: null },
    select: {
      lastReadAt: true,
      chat: {
        select: {
          ...CHAT_SELECT,
          messages: {
            where:   { isDeleted: false },
            orderBy: { createdAt: 'desc' },
            take:    1,
            select:  MESSAGE_SELECT,
          },
        },
      },
    },
    orderBy: { chat: { updatedAt: 'desc' } },
  });

  return participations.map(({ lastReadAt, chat }) => {
    const lastMessage = chat.messages?.[0] ?? null;
    return { ...chat, messages: undefined, lastMessage, lastReadAt };
  });
}

// ─────────────────────────────────────────────────────────────
// getMessages — cursor-paginated message history
// ─────────────────────────────────────────────────────────────
async function getMessages(chatId, userId, { limit = 30, cursor = null }) {
  await assertParticipant(chatId, userId);

  const messages = await prisma.message.findMany({
    where: { chatId, isDeleted: false },
    select:  MESSAGE_SELECT,
    orderBy: { createdAt: 'desc' },
    take:    limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  // Return in ascending order for display (oldest first)
  const ordered = [...messages].reverse();
  const meta    = buildCursorMeta({ data: messages, limit });

  return { messages: ordered, pagination: meta };
}

// ─────────────────────────────────────────────────────────────
// createMessage — from REST or socket handler
// ─────────────────────────────────────────────────────────────
async function createMessage(chatId, senderId, { body, replyToId, mediaUrl, mediaType }) {
  await assertParticipant(chatId, senderId);

  if (!body && !mediaUrl) {
    throw new AppError('Message body or media is required', HTTP.BAD_REQUEST);
  }

  if (replyToId) {
    const parent = await prisma.message.findFirst({
      where: { id: replyToId, chatId, isDeleted: false },
    });
    if (!parent) throw new AppError('Reply target not found', HTTP.NOT_FOUND);
  }

  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        chatId,
        senderId,
        body:      body?.trim() ?? null,
        replyToId: replyToId ?? null,
        mediaUrl:  mediaUrl  ?? null,
        mediaType: mediaType ?? null,
        status:    'SENT',
      },
      select: MESSAGE_SELECT,
    });

    // Bump the chat's updatedAt so getUserChats sorts correctly
    await tx.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

    return msg;
  });

  return message;
}

// ─────────────────────────────────────────────────────────────
// editMessage
// ─────────────────────────────────────────────────────────────
async function editMessage(messageId, userId, newBody) {
  const msg = await prisma.message.findFirst({
    where: { id: messageId, senderId: userId, isDeleted: false },
  });
  if (!msg) throw new AppError('Message not found or not yours', HTTP.NOT_FOUND);

  // 15-minute edit window
  const ageMinutes = (Date.now() - new Date(msg.createdAt).getTime()) / 60_000;
  if (ageMinutes > 15) {
    throw new AppError('Messages can only be edited within 15 minutes of sending', HTTP.BAD_REQUEST, 'EDIT_WINDOW_EXPIRED');
  }

  return prisma.message.update({
    where: { id: messageId },
    data:  { body: newBody.trim(), isEdited: true, editedAt: new Date() },
    select: MESSAGE_SELECT,
  });
}

// ─────────────────────────────────────────────────────────────
// deleteMessage — soft delete
// ─────────────────────────────────────────────────────────────
async function deleteMessage(messageId, userId) {
  const msg = await prisma.message.findFirst({
    where: { id: messageId, senderId: userId, isDeleted: false },
  });
  if (!msg) throw new AppError('Message not found or not yours', HTTP.NOT_FOUND);

  return prisma.message.update({
    where: { id: messageId },
    data:  { isDeleted: true, deletedAt: new Date(), body: null },
    select: { id: true, chatId: true, isDeleted: true, deletedAt: true },
  });
}

// ─────────────────────────────────────────────────────────────
// markDelivered — flip SENT → DELIVERED for all unread in chat
// ─────────────────────────────────────────────────────────────
async function markDelivered(chatId, userId) {
  await prisma.message.updateMany({
    where: { chatId, status: 'SENT', senderId: { not: userId } },
    data:  { status: 'DELIVERED' },
  });
}

// ─────────────────────────────────────────────────────────────
// markMessageRead — single message DELIVERED/SENT → READ
// Also updates the participant's lastReadAt cursor
// ─────────────────────────────────────────────────────────────
async function markMessageRead(chatId, userId, messageId) {
  await prisma.$transaction([
    prisma.message.updateMany({
      where: { chatId, id: messageId, status: { in: ['SENT', 'DELIVERED'] } },
      data:  { status: 'READ' },
    }),
    prisma.chatParticipant.updateMany({
      where: { chatId, userId },
      data:  { lastReadAt: new Date() },
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function isParticipant(chatId, userId) {
  const p = await prisma.chatParticipant.findUnique({
    where:  { chatId_userId: { chatId, userId } },
    select: { leftAt: true },
  });
  return p !== null && p.leftAt === null;
}

async function assertParticipant(chatId, userId) {
  const ok = await isParticipant(chatId, userId);
  if (!ok) throw new AppError('You are not a participant in this chat', HTTP.FORBIDDEN, 'NOT_PARTICIPANT');
}

async function getParticipantIds(chatId) {
  const rows = await prisma.chatParticipant.findMany({
    where:  { chatId, leftAt: null },
    select: { userId: true },
  });
  return rows.map(r => r.userId);
}

module.exports = {
  getOrCreateDirectChat,
  createMentorChat,
  getChatById,
  getUserChats,
  getMessages,
  createMessage,
  editMessage,
  deleteMessage,
  markDelivered,
  markMessageRead,
  isParticipant,
  getParticipantIds,
};
