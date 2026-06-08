// src/services/user.service.js — User & profile business logic

const { prisma }  = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { uploadAvatar, deleteFromCloudinary } = require('../utils/cloudinaryUpload');
const { buildPaginationMeta } = require('../utils/pagination');
const { getRedisClient, RedisKeys } = require('../config/redis');

// ─── Field selectors ──────────────────────────────────────────

// What's safe to return for public profiles
const PUBLIC_USER_SELECT = {
  id: true, username: true, anonymousAlias: true, role: true,
  createdAt: true,
  profile: {
    select: {
      displayName: true, bio: true, avatarUrl: true,
      college: true, department: true, year: true,
      skills: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true,
      reputationPoints: true, postCount: true, answerCount: true, helperScore: true,
      isProfilePublic: true,
    },
  },
  mentorProfile: {
    select: {
      headline: true, expertise: true, currentCompany: true,
      yearsOfExperience: true, isAvailable: true, avgRating: true,
      totalSessions: true, verifiedMentor: true, sessionTopics: true,
    },
  },
  badges: { select: { badge: true, awardedAt: true } },
};

// Own profile — adds private fields
const OWN_USER_SELECT = {
  ...PUBLIC_USER_SELECT,
  email: true,
  isEmailVerified: true,
  lastLoginAt: true,
  profile: {
    select: {
      ...PUBLIC_USER_SELECT.profile.select,
      isProfilePublic: true,
    },
  },
};

// ─────────────────────────────────────────────────────────────
// getMe — authenticated user's own full profile
// ─────────────────────────────────────────────────────────────
async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where:  { id: userId, deletedAt: null },
    select: OWN_USER_SELECT,
  });
  if (!user) throw new AppError('User not found', HTTP.NOT_FOUND);
  return user;
}

// ─────────────────────────────────────────────────────────────
// getUserById — public profile lookup
// ─────────────────────────────────────────────────────────────
async function getUserById(targetId, requestingUserId) {
  const user = await prisma.user.findUnique({
    where:  { id: targetId, deletedAt: null, isActive: true },
    select: PUBLIC_USER_SELECT,
  });

  if (!user) throw new AppError('User not found', HTTP.NOT_FOUND);

  // Respect private profile setting (owner and admins bypass)
  if (!user.profile?.isProfilePublic && targetId !== requestingUserId) {
    // Return minimal info only
    return {
      id:             user.id,
      username:       user.username,
      anonymousAlias: user.anonymousAlias,
      role:           user.role,
      profile:        { isProfilePublic: false },
    };
  }

  // Attach follower counts
  const [followerCount, followingCount, isFollowing] = await Promise.all([
    prisma.follow.count({ where: { followingId: targetId } }),
    prisma.follow.count({ where: { followerId:  targetId } }),
    requestingUserId
      ? prisma.follow.findUnique({ where: { followerId_followingId: { followerId: requestingUserId, followingId: targetId } } })
      : null,
  ]);

  return { ...user, followerCount, followingCount, isFollowing: !!isFollowing };
}

// ─────────────────────────────────────────────────────────────
// getUsers — paginated list with filters
// ─────────────────────────────────────────────────────────────
async function getUsers({ page, limit, search, role, college, department, year, sortBy, order }) {
  const skip = (page - 1) * limit;

  const where = {
    deletedAt: null,
    isActive:  true,
    isBanned:  false,
    ...(role       ? { role } : {}),
  };

  // Profile-level filters need a nested where
  const profileWhere = {};
  if (college)    profileWhere.college    = { contains: college,    mode: 'insensitive' };
  if (department) profileWhere.department = { contains: department, mode: 'insensitive' };
  if (year)       profileWhere.year       = year;
  if (search) {
    profileWhere.OR = [
      { displayName: { contains: search, mode: 'insensitive' } },
      { college:     { contains: search, mode: 'insensitive' } },
    ];
  }

  if (Object.keys(profileWhere).length > 0) {
    where.profile = { is: profileWhere };
  }

  // Map sortBy to actual orderBy
  const orderByMap = {
    reputation: { profile: { reputationPoints: order } },
    createdAt:  { createdAt: order },
    name:       { profile: { displayName: order } },
  };
  const orderBy = orderByMap[sortBy] ?? orderByMap.reputation;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: PUBLIC_USER_SELECT,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit, data: users });
  return { users, pagination };
}

// ─────────────────────────────────────────────────────────────
// updateProfile
// ─────────────────────────────────────────────────────────────
async function updateProfile(userId, data) {
  // Ensure profile exists (created at registration, but defensive)
  const existing = await prisma.profile.findUnique({ where: { userId } });
  if (!existing) throw new AppError('Profile not found', HTTP.NOT_FOUND);

  const updated = await prisma.profile.update({
    where: { userId },
    data: {
      ...(data.displayName    !== undefined && { displayName:    data.displayName }),
      ...(data.bio            !== undefined && { bio:            data.bio }),
      ...(data.college        !== undefined && { college:        data.college }),
      ...(data.department     !== undefined && { department:     data.department }),
      ...(data.year           !== undefined && { year:           data.year }),
      ...(data.skills         !== undefined && { skills:         data.skills }),
      ...(data.linkedinUrl    !== undefined && { linkedinUrl:    data.linkedinUrl }),
      ...(data.githubUrl      !== undefined && { githubUrl:      data.githubUrl }),
      ...(data.portfolioUrl   !== undefined && { portfolioUrl:   data.portfolioUrl }),
      ...(data.isProfilePublic !== undefined && { isProfilePublic: data.isProfilePublic }),
    },
    select: {
      displayName: true, bio: true, college: true, department: true, year: true,
      skills: true, linkedinUrl: true, githubUrl: true, portfolioUrl: true,
      reputationPoints: true, isProfilePublic: true, avatarUrl: true,
    },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────
// uploadAvatar
// ─────────────────────────────────────────────────────────────
async function updateAvatar(userId, fileBuffer) {
  // Delete old avatar from Cloudinary if present
  const profile = await prisma.profile.findUnique({
    where:  { userId },
    select: { avatarPublicId: true },
  });

  if (profile?.avatarPublicId) {
    await deleteFromCloudinary(profile.avatarPublicId).catch(() => {});
  }

  const uploaded = await uploadAvatar(fileBuffer, userId);

  await prisma.profile.update({
    where: { userId },
    data:  { avatarUrl: uploaded.url, avatarPublicId: uploaded.publicId },
  });

  return { avatarUrl: uploaded.url };
}

// ─────────────────────────────────────────────────────────────
// deleteAvatar
// ─────────────────────────────────────────────────────────────
async function deleteAvatar(userId) {
  const profile = await prisma.profile.findUnique({
    where:  { userId },
    select: { avatarPublicId: true },
  });

  if (profile?.avatarPublicId) {
    await deleteFromCloudinary(profile.avatarPublicId).catch(() => {});
  }

  await prisma.profile.update({
    where: { userId },
    data:  { avatarUrl: null, avatarPublicId: null },
  });

  return { deleted: true };
}

// ─────────────────────────────────────────────────────────────
// updateMentorProfile — upsert mentor details
// ─────────────────────────────────────────────────────────────
async function updateMentorProfile(userId, data) {
  // Ensure user has mentor role
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { role: true },
  });
  if (!user || !['MENTOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    throw new AppError('Only mentors can update mentor profiles', HTTP.FORBIDDEN, 'NOT_A_MENTOR');
  }

  const updated = await prisma.mentorProfile.upsert({
    where:  { userId },
    create: { userId, ...data },
    update: data,
    select: {
      headline: true, expertise: true, currentCompany: true,
      yearsOfExperience: true, isAvailable: true, maxWeeklySessions: true,
      preferredSessionLen: true, sessionTopics: true, avgRating: true,
      totalSessions: true, verifiedMentor: true,
    },
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────
// upsertAvailability — replace all availability slots
// ─────────────────────────────────────────────────────────────
async function upsertAvailability(userId, slots) {
  const mentorProfile = await prisma.mentorProfile.findUnique({
    where:  { userId },
    select: { id: true },
  });
  if (!mentorProfile) {
    throw new AppError('Mentor profile not found. Set up your mentor profile first.', HTTP.NOT_FOUND);
  }

  // Replace all slots in a transaction
  const result = await prisma.$transaction([
    prisma.mentorAvailability.deleteMany({ where: { mentorProfileId: mentorProfile.id } }),
    prisma.mentorAvailability.createMany({
      data: slots.map((s) => ({ ...s, mentorProfileId: mentorProfile.id })),
    }),
  ]);

  return await prisma.mentorAvailability.findMany({
    where: { mentorProfileId: mentorProfile.id },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
}

// ─────────────────────────────────────────────────────────────
// followUser / unfollowUser
// ─────────────────────────────────────────────────────────────
async function followUser(followerId, followingId) {
  if (followerId === followingId) {
    throw new AppError('You cannot follow yourself', HTTP.BAD_REQUEST, 'SELF_FOLLOW');
  }

  const target = await prisma.user.findUnique({
    where:  { id: followingId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!target) throw new AppError('User not found', HTTP.NOT_FOUND);

  try {
    await prisma.follow.create({ data: { followerId, followingId } });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('You are already following this user', HTTP.CONFLICT, 'ALREADY_FOLLOWING');
    }
    throw err;
  }

  // Award reputation to the followed user (non-blocking)
  prisma.profile.update({
    where: { userId: followingId },
    data:  { reputationPoints: { increment: 2 } },
  }).catch(() => {});

  return { following: true };
}

async function unfollowUser(followerId, followingId) {
  const follow = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId, followingId } },
  });
  if (!follow) {
    throw new AppError('You are not following this user', HTTP.NOT_FOUND, 'NOT_FOLLOWING');
  }

  await prisma.follow.delete({ where: { followerId_followingId: { followerId, followingId } } });

  return { following: false };
}

// ─────────────────────────────────────────────────────────────
// getFollowers / getFollowing — paginated
// ─────────────────────────────────────────────────────────────
async function getFollowers(userId, { page, limit }) {
  const skip = (page - 1) * limit;
  const [follows, total] = await Promise.all([
    prisma.follow.findMany({
      where:   { followingId: userId },
      skip,
      take:    limit,
      orderBy: { createdAt: 'desc' },
      select:  {
        createdAt: true,
        follower: { select: { id: true, username: true, anonymousAlias: true, profile: { select: { displayName: true, avatarUrl: true, college: true } } } },
      },
    }),
    prisma.follow.count({ where: { followingId: userId } }),
  ]);

  const followers  = follows.map((f) => ({ ...f.follower, followedAt: f.createdAt }));
  const pagination = buildPaginationMeta({ total, page, limit, data: followers });
  return { followers, pagination };
}

async function getFollowing(userId, { page, limit }) {
  const skip = (page - 1) * limit;
  const [follows, total] = await Promise.all([
    prisma.follow.findMany({
      where:   { followerId: userId },
      skip,
      take:    limit,
      orderBy: { createdAt: 'desc' },
      select:  {
        createdAt: true,
        following: { select: { id: true, username: true, anonymousAlias: true, profile: { select: { displayName: true, avatarUrl: true, college: true } } } },
      },
    }),
    prisma.follow.count({ where: { followerId: userId } }),
  ]);

  const following  = follows.map((f) => ({ ...f.following, followedAt: f.createdAt }));
  const pagination = buildPaginationMeta({ total, page, limit, data: following });
  return { following, pagination };
}

// ─────────────────────────────────────────────────────────────
// deleteAccount — soft delete with data anonymisation
// ─────────────────────────────────────────────────────────────
async function deleteAccount(userId, password) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new AppError('User not found', HTTP.NOT_FOUND);

  const isMatch = await require('bcryptjs').compare(password, user.passwordHash);
  if (!isMatch) {
    throw new AppError('Password is incorrect', HTTP.BAD_REQUEST, 'WRONG_PASSWORD');
  }

  // Soft delete + scrub PII
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt:    new Date(),
        isActive:     false,
        email:        `deleted_${userId}@removed.invalid`,
        passwordHash: 'DELETED',
        refreshToken: null,
      },
    }),
    prisma.profile.update({
      where: { userId },
      data: { bio: null, linkedinUrl: null, githubUrl: null, portfolioUrl: null, avatarUrl: null, avatarPublicId: null },
    }),
  ]);

  // Revoke tokens
  await revokeRefreshToken(userId).catch(() => {});

  return { deleted: true };
}

// ─────────────────────────────────────────────────────────────
// updateLastSeen — called by socket on disconnect
// ─────────────────────────────────────────────────────────────
async function updateLastSeen(userId) {
  await prisma.user.update({
    where: { id: userId },
    data:  { lastSeenAt: new Date() },
  }).catch(() => {});
}

module.exports = {
  getMe,
  getUserById,
  getUsers,
  updateProfile,
  updateAvatar,
  deleteAvatar,
  updateMentorProfile,
  upsertAvailability,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  deleteAccount,
  updateLastSeen,
};
