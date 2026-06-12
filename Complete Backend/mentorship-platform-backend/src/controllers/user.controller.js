// src/controllers/user.controller.js

const userService = require('../services/user.service');
const {
  successResponse,
  paginatedResponse,
  noContentResponse,
} = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');
const { AppError } = require('../middleware/error');
const { HTTP } = require('../constants/statusCodes');

/**
 * @swagger
 * /users/me:
 *   get:
 *     summary: Get the authenticated user's own full profile
 *     tags: [Users]
 */
async function getMe(req, res) {
  const user = await userService.getMe(req.user.id);
  return successResponse(res, { message: 'Profile fetched', data: user });
}

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get a user's public profile by ID
 *     tags: [Users]
 */
async function getUserById(req, res) {
  const user = await userService.getUserById(req.params.id, req.user?.id ?? null);
  return successResponse(res, { message: 'User fetched', data: user });
}

/**
 * @swagger
 * /users:
 *   get:
 *     summary: List users with pagination and filtering
 *     tags: [Users]
 */
async function getUsers(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { search, role, college, department, year, sortBy, order } = req.query;

  const { users, pagination } = await userService.getUsers({
    page, limit, search, role, college, department, year,
    sortBy: sortBy ?? 'reputation',
    order:  order  ?? 'desc',
  });

  return paginatedResponse(res, {
    message: 'Users fetched',
    data:    users,
    pagination,
  });
}

/**
 * @swagger
 * /users/me/profile:
 *   patch:
 *     summary: Update the authenticated user's profile
 *     tags: [Users]
 */
async function updateProfile(req, res) {
  const updated = await userService.updateProfile(req.user.id, req.body);
  return successResponse(res, { message: 'Profile updated', data: updated });
}

/**
 * @swagger
 * /users/me/avatar:
 *   post:
 *     summary: Upload or replace profile avatar
 *     tags: [Users]
 */
async function uploadAvatar(req, res) {
  if (!req.file) {
    throw new AppError('No image file provided', HTTP.BAD_REQUEST, 'NO_FILE');
  }
  const result = await userService.updateAvatar(req.user.id, req.file.buffer);
  return successResponse(res, { message: 'Avatar updated', data: result });
}

/**
 * @swagger
 * /users/me/avatar:
 *   delete:
 *     summary: Remove profile avatar
 *     tags: [Users]
 */
async function deleteAvatar(req, res) {
  const result = await userService.deleteAvatar(req.user.id);
  return successResponse(res, { message: 'Avatar removed', data: result });
}

/**
 * @swagger
 * /users/me/mentor-profile:
 *   put:
 *     summary: Create or update mentor profile details
 *     tags: [Users]
 */
async function updateMentorProfile(req, res) {
  const updated = await userService.updateMentorProfile(req.user.id, req.body);
  return successResponse(res, { message: 'Mentor profile updated', data: updated });
}

/**
 * @swagger
 * /users/me/availability:
 *   put:
 *     summary: Replace all mentor availability slots
 *     tags: [Users]
 */
async function upsertAvailability(req, res) {
  const slots = await userService.upsertAvailability(req.user.id, req.body.slots);
  return successResponse(res, { message: 'Availability updated', data: slots });
}

/**
 * @swagger
 * /users/{id}/follow:
 *   post:
 *     summary: Follow a user
 *     tags: [Users]
 */
async function followUser(req, res) {
  const result = await userService.followUser(req.user.id, req.params.id);
  return successResponse(res, { message: 'User followed', data: result });
}

/**
 * @swagger
 * /users/{id}/follow:
 *   delete:
 *     summary: Unfollow a user
 *     tags: [Users]
 */
async function unfollowUser(req, res) {
  const result = await userService.unfollowUser(req.user.id, req.params.id);
  return successResponse(res, { message: 'User unfollowed', data: result });
}

/**
 * @swagger
 * /users/{id}/followers:
 *   get:
 *     summary: Get a user's followers (paginated)
 *     tags: [Users]
 */
async function getFollowers(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { followers, pagination } = await userService.getFollowers(req.params.id, { page, limit });
  return paginatedResponse(res, { message: 'Followers fetched', data: followers, pagination });
}

/**
 * @swagger
 * /users/{id}/following:
 *   get:
 *     summary: Get users a user is following (paginated)
 *     tags: [Users]
 */
async function getFollowing(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { following, pagination } = await userService.getFollowing(req.params.id, { page, limit });
  return paginatedResponse(res, { message: 'Following fetched', data: following, pagination });
}

/**
 * @swagger
 * /users/me:
 *   delete:
 *     summary: Soft-delete the authenticated account
 *     tags: [Users]
 */
async function deleteAccount(req, res) {
  const { password } = req.body;
  if (!password) {
    throw new AppError('Password confirmation required to delete account', HTTP.BAD_REQUEST);
  }

  await userService.deleteAccount(req.user.id, password);

  res.clearCookie('refreshToken', { path: '/api/v1/auth/refresh' });
  return successResponse(res, { message: 'Account deleted successfully' });
}

module.exports = {
  getMe,
  getUserById,
  getUsers,
  updateProfile,
  uploadAvatar,
  deleteAvatar,
  updateMentorProfile,
  upsertAvailability,
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
  deleteAccount,
};
