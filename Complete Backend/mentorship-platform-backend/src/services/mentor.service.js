// src/services/mentor.service.js

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');
const { createMentorChat }    = require('./chat.service');
const {
  notifyMentorRequest,
  notifyMentorAccepted,
  notifyMentorDeclined,
} = require('./notification.service');
const { logger } = require('../utils/logger');

const MENTOR_PROFILE_SELECT = {
  id: true, headline: true, expertise: true, currentCompany: true,
  yearsOfExperience: true, placementYear: true, isAvailable: true,
  maxWeeklySessions: true, preferredSessionLen: true, sessionTopics: true,
  totalSessions: true, avgRating: true, totalRatings: true, verifiedMentor: true,
  createdAt: true,
  availability: { where: { isActive: true }, select: { id: true, dayOfWeek: true, startTime: true, endTime: true } },
  user: {
    select: {
      id: true, username: true, anonymousAlias: true,
      profile: { select: { displayName: true, avatarUrl: true, college: true, department: true, year: true, bio: true } },
    },
  },
};

const REQUEST_SELECT = {
  id: true, topic: true, description: true, status: true,
  scheduledAt: true, declineReason: true, isAnonymous: true,
  chatRoomId: true, createdAt: true, updatedAt: true,
  requester: {
    select: { id: true, username: true, anonymousAlias: true,
      profile: { select: { displayName: true, avatarUrl: true, college: true } } },
  },
  mentorProfile: {
    select: { id: true, headline: true,
      user: { select: { id: true, username: true, anonymousAlias: true,
        profile: { select: { displayName: true, avatarUrl: true } } } } },
  },
};

// ─────────────────────────────────────────────────────────────
// getMentors — browsable, filterable mentor directory
// ─────────────────────────────────────────────────────────────
async function getMentors({ page, limit, expertise, company, available, search, sortBy }) {
  const skip  = (page - 1) * limit;
  const where = {};

  if (available !== undefined) where.isAvailable = available;
  if (company)   where.currentCompany = { contains: company, mode: 'insensitive' };
  if (expertise) where.expertise = { has: expertise };

  if (search) {
    where.OR = [
      { headline:       { contains: search, mode: 'insensitive' } },
      { sessionTopics:  { has: search } },
      { user: { profile: { displayName: { contains: search, mode: 'insensitive' } } } },
      { user: { profile: { college:     { contains: search, mode: 'insensitive' } } } },
    ];
  }

  const orderBy = {
    rating:   { avgRating:     'desc' },
    sessions: { totalSessions: 'desc' },
    recent:   { createdAt:     'desc' },
  }[sortBy] ?? { avgRating: 'desc' };

  const [mentors, total] = await Promise.all([
    prisma.mentorProfile.findMany({
      where,
      select:  MENTOR_PROFILE_SELECT,
      orderBy,
      skip,
      take:    limit,
    }),
    prisma.mentorProfile.count({ where }),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit, data: mentors });
  return { mentors, pagination };
}

// ─────────────────────────────────────────────────────────────
// getMentorById — single mentor public page
// ─────────────────────────────────────────────────────────────
async function getMentorById(mentorProfileId) {
  const mentor = await prisma.mentorProfile.findUnique({
    where:  { id: mentorProfileId },
    select: MENTOR_PROFILE_SELECT,
  });
  if (!mentor) throw new AppError('Mentor not found', HTTP.NOT_FOUND);
  return mentor;
}

// ─────────────────────────────────────────────────────────────
// createRequest — student books a mentor session
// ─────────────────────────────────────────────────────────────
async function createRequest(requesterId, { mentorProfileId, topic, description, scheduledAt, isAnonymous }) {
  const mentor = await prisma.mentorProfile.findUnique({
    where:  { id: mentorProfileId },
    select: {
      id: true, isAvailable: true, maxWeeklySessions: true,
      userId: true,
      user: { select: { id: true, anonymousAlias: true } },
    },
  });

  if (!mentor) throw new AppError('Mentor not found', HTTP.NOT_FOUND);
  if (!mentor.isAvailable) {
    throw new AppError('This mentor is currently unavailable for new requests', HTTP.CONFLICT, 'MENTOR_UNAVAILABLE');
  }

  // Prevent duplicate pending request
  const duplicate = await prisma.mentorRequest.findFirst({
    where: { requesterId, mentorProfileId, status: 'PENDING' },
  });
  if (duplicate) {
    throw new AppError('You already have a pending request with this mentor', HTTP.CONFLICT, 'DUPLICATE_REQUEST');
  }

  // Enforce weekly session cap
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const weeklyCount = await prisma.mentorRequest.count({
    where: {
      mentorProfileId,
      status:    { in: ['ACCEPTED', 'PENDING'] },
      createdAt: { gte: weekStart },
    },
  });
  if (weeklyCount >= mentor.maxWeeklySessions) {
    throw new AppError('This mentor has reached their weekly session limit', HTTP.CONFLICT, 'SESSION_LIMIT_REACHED');
  }

  const request = await prisma.mentorRequest.create({
    data: {
      requesterId,
      mentorProfileId,
      topic,
      description,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      isAnonymous: isAnonymous ?? false,
      status: 'PENDING',
    },
    select: REQUEST_SELECT,
  });

  // Fire-and-forget notification to mentor
  notifyMentorRequest(mentor.userId, requesterId, {
    requestId: request.id,
    topic,
  }).catch(() => {});

  return request;
}

// ─────────────────────────────────────────────────────────────
// respondToRequest — mentor accepts or declines
// ─────────────────────────────────────────────────────────────
async function respondToRequest(mentorUserId, requestId, { action, scheduledAt, declineReason }) {
  const request = await prisma.mentorRequest.findUnique({
    where:  { id: requestId },
    select: {
      ...REQUEST_SELECT,
      mentorProfile: { select: { userId: true, id: true } },
    },
  });

  if (!request) throw new AppError('Request not found', HTTP.NOT_FOUND);
  if (request.mentorProfile.userId !== mentorUserId) {
    throw new AppError('Not your request to respond to', HTTP.FORBIDDEN);
  }
  if (request.status !== 'PENDING') {
    throw new AppError(`Request is already ${request.status.toLowerCase()}`, HTTP.CONFLICT, 'REQUEST_CLOSED');
  }

  const newStatus = action === 'accept' ? 'ACCEPTED' : 'DECLINED';

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.mentorRequest.update({
      where: { id: requestId },
      data:  {
        status:        newStatus,
        scheduledAt:   scheduledAt ? new Date(scheduledAt) : request.scheduledAt,
        declineReason: declineReason ?? null,
      },
      select: REQUEST_SELECT,
    });

    if (newStatus === 'ACCEPTED') {
      // Create the mentor session record
      await tx.mentorSession.create({
        data: {
          requestId,
          menteeId:    request.requester.id,
          mentorUserId,
          status:      'SCHEDULED',
        },
      });
    }

    return updatedRequest;
  });

  // Create the private chat room on acceptance
  if (newStatus === 'ACCEPTED' && !updated.chatRoomId) {
    createMentorChat(requestId, request.requester.id, mentorUserId)
      .catch((err) => logger.error(`createMentorChat failed: ${err.message}`));
  }

  // Notify the requester
  if (newStatus === 'ACCEPTED') {
    notifyMentorAccepted(request.requester.id, mentorUserId, {
      requestId,
      mentorAlias: request.mentorProfile.user?.anonymousAlias ?? 'your mentor',
    }).catch(() => {});
  } else {
    notifyMentorDeclined(request.requester.id, mentorUserId, { requestId }).catch(() => {});
  }

  return updated;
}

// ─────────────────────────────────────────────────────────────
// cancelRequest — requester cancels their own PENDING request
// ─────────────────────────────────────────────────────────────
async function cancelRequest(requesterId, requestId) {
  const request = await prisma.mentorRequest.findFirst({
    where: { id: requestId, requesterId },
  });
  if (!request) throw new AppError('Request not found', HTTP.NOT_FOUND);
  if (!['PENDING', 'ACCEPTED'].includes(request.status)) {
    throw new AppError('Cannot cancel a completed or already cancelled request', HTTP.CONFLICT);
  }

  return prisma.mentorRequest.update({
    where: { id: requestId },
    data:  { status: 'CANCELLED' },
    select: REQUEST_SELECT,
  });
}

// ─────────────────────────────────────────────────────────────
// getRequests — list for mentor or mentee
// ─────────────────────────────────────────────────────────────
async function getRequests(userId, { page, limit, status, role }) {
  const skip = (page - 1) * limit;

  // Resolve the user's mentor profile ID if they are querying as mentor
  let mentorProfileId;
  if (role === 'mentor') {
    const mp = await prisma.mentorProfile.findUnique({
      where: { userId }, select: { id: true },
    });
    if (!mp) throw new AppError('Mentor profile not found', HTTP.NOT_FOUND);
    mentorProfileId = mp.id;
  }

  const where = {
    ...(role === 'mentor'  ? { mentorProfileId }     : { requesterId: userId }),
    ...(status             ? { status }               : {}),
  };

  const [requests, total] = await Promise.all([
    prisma.mentorRequest.findMany({
      where,
      select:  REQUEST_SELECT,
      orderBy: { createdAt: 'desc' },
      skip,
      take:    limit,
    }),
    prisma.mentorRequest.count({ where }),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit, data: requests });
  return { requests, pagination };
}

// ─────────────────────────────────────────────────────────────
// submitFeedback — mentee rates completed session
// ─────────────────────────────────────────────────────────────
async function submitFeedback(menteeId, requestId, { feedbackRating, feedbackText }) {
  const request = await prisma.mentorRequest.findFirst({
    where:  { id: requestId, requesterId: menteeId },
    select: { id: true, status: true, mentorProfileId: true },
  });

  if (!request) throw new AppError('Request not found', HTTP.NOT_FOUND);
  if (request.status !== 'COMPLETED') {
    throw new AppError('Feedback can only be submitted for completed sessions', HTTP.CONFLICT);
  }

  // Check not already rated
  const session = await prisma.mentorSession.findUnique({
    where:  { requestId },
    select: { id: true, feedbackRating: true },
  });
  if (session?.feedbackRating) {
    throw new AppError('Feedback already submitted for this session', HTTP.CONFLICT, 'FEEDBACK_EXISTS');
  }

  const updatedSession = await prisma.$transaction(async (tx) => {
    const s = await tx.mentorSession.update({
      where: { requestId },
      data:  { feedbackRating, feedbackText: feedbackText ?? null },
      select: { id: true, feedbackRating: true, feedbackText: true },
    });

    // Recompute mentor's average rating
    const allRatings = await tx.mentorSession.findMany({
      where:  { request: { mentorProfileId: request.mentorProfileId }, feedbackRating: { not: null } },
      select: { feedbackRating: true },
    });
    const avg = allRatings.reduce((sum, r) => sum + r.feedbackRating, 0) / allRatings.length;

    await tx.mentorProfile.update({
      where: { id: request.mentorProfileId },
      data:  {
        avgRating:    parseFloat(avg.toFixed(2)),
        totalRatings: allRatings.length,
      },
    });

    return s;
  });

  return updatedSession;
}

// ─────────────────────────────────────────────────────────────
// completeSession — mentor marks session as done
// ─────────────────────────────────────────────────────────────
async function completeSession(mentorUserId, requestId) {
  const session = await prisma.mentorSession.findFirst({
    where:  { requestId, mentorUserId },
    select: { id: true, status: true, startedAt: true },
  });
  if (!session) throw new AppError('Session not found', HTTP.NOT_FOUND);
  if (session.status === 'COMPLETED') {
    throw new AppError('Session already completed', HTTP.CONFLICT);
  }

  const now = new Date();
  const durationMinutes = session.startedAt
    ? Math.round((now - new Date(session.startedAt)) / 60_000)
    : null;

  await prisma.$transaction([
    prisma.mentorSession.update({
      where: { id: session.id },
      data:  { status: 'COMPLETED', endedAt: now, durationMinutes },
    }),
    prisma.mentorRequest.update({
      where: { id: requestId },
      data:  { status: 'COMPLETED' },
    }),
    prisma.mentorProfile.update({
      where: { userId: mentorUserId },
      data:  { totalSessions: { increment: 1 } },
    }),
  ]);

  return { message: 'Session marked as completed', durationMinutes };
}

module.exports = {
  getMentors,
  getMentorById,
  createRequest,
  respondToRequest,
  cancelRequest,
  getRequests,
  submitFeedback,
  completeSession,
};
