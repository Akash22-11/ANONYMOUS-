const adminService    = require('../services/admin.service');
const resourceService = require('../services/resource.service');
const {
  successResponse, paginatedResponse,
} = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');
const { z } = require('zod');

async function getAnalytics(req, res) {
  const period = ['7d', '30d', '90d', 'all'].includes(req.query.period)
    ? req.query.period : '30d';
  const data = await adminService.getAnalytics(period);
  return successResponse(res, { message: 'Analytics fetched', data });
}

async function getUsers(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { role, banned, search, sortBy } = req.query;

  const { users, pagination } = await adminService.getUsers({
    page, limit, role,
    banned: banned !== undefined ? banned === 'true' : undefined,
    search, sortBy,
  });

  return paginatedResponse(res, { message: 'Users fetched', data: users, pagination });
}

/**
 * @swagger
 * /admin/users/{id}:
 *   get:
 *     summary: Full user detail for admin inspection
 *     tags: [Admin]
 */
async function getUserDetail(req, res) {
  const user = await adminService.getUserDetail(req.params.id);
  return successResponse(res, { message: 'User detail fetched', data: user });
}

/**
 * @swagger
 * /admin/users/{id}/ban:
 *   post:
 *     summary: Ban a user
 *     tags: [Admin]
 */
async function banUser(req, res) {
  const user = await adminService.banUser(req.user.id, req.params.id, req.body);
  return successResponse(res, { message: 'User banned', data: user });
}

/**
 * @swagger
 * /admin/users/{id}/unban:
 *   post:
 *     summary: Unban a user
 *     tags: [Admin]
 */
async function unbanUser(req, res) {
  const user = await adminService.unbanUser(req.user.id, req.params.id);
  return successResponse(res, { message: 'User unbanned', data: user });
}

/**
 * @swagger
 * /admin/users/{id}/role:
 *   patch:
 *     summary: Change a user's role
 *     tags: [Admin]
 */
async function changeUserRole(req, res) {
  const user = await adminService.changeUserRole(req.user.id, req.params.id, req.body);
  return successResponse(res, { message: 'User role updated', data: user });
}

// ─── Post moderation ──────────────────────────────────────────

/**
 * @swagger
 * /admin/posts/{id}/status:
 *   patch:
 *     summary: Change a post's status (archive, remove, restore)
 *     tags: [Admin]
 */
async function updatePostStatus(req, res) {
  const post = await adminService.updatePostStatus(req.user.id, req.params.id, req.body);
  return successResponse(res, { message: 'Post status updated', data: post });
}

/**
 * @swagger
 * /admin/posts/{id}:
 *   delete:
 *     summary: Hard-remove a post (irreversible soft delete)
 *     tags: [Admin]
 */
async function deletePost(req, res) {
  await adminService.deletePost(req.user.id, req.params.id, req.body.reason);
  return successResponse(res, { message: 'Post removed' });
}

// ─── Resource moderation ──────────────────────────────────────

/**
 * @swagger
 * /admin/resources/pending:
 *   get:
 *     summary: Resources awaiting approval (FIFO queue)
 *     tags: [Admin]
 */
async function getPendingResources(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { resources, pagination } = await adminService.getPendingResources({ page, limit });
  return paginatedResponse(res, { message: 'Pending resources fetched', data: resources, pagination });
}

/**
 * @swagger
 * /admin/resources/{id}/review:
 *   patch:
 *     summary: Approve or reject a resource
 *     tags: [Admin]
 */
async function reviewResource(req, res) {
  const resource = await resourceService.approveResource(
    req.params.id,
    req.user.id,
    req.body,
  );
  const action = req.body.approved ? 'approved' : 'rejected';
  return successResponse(res, { message: `Resource ${action}`, data: resource });
}

// ─── Mentor verification ─────────────────────────────────────

/**
 * @swagger
 * /admin/mentors/{id}/verify:
 *   patch:
 *     summary: Verify or unverify a mentor profile
 *     tags: [Admin]
 */
async function verifyMentor(req, res) {
  const result = await adminService.verifyMentor(req.user.id, req.params.id, req.body);
  const action = req.body.verified ? 'verified' : 'unverified';
  return successResponse(res, { message: `Mentor ${action}`, data: result });
}

// ─── Audit log ────────────────────────────────────────────────

/**
 * @swagger
 * /admin/audit-log:
 *   get:
 *     summary: Paginated admin action audit trail
 *     tags: [Admin]
 */
async function getAuditLog(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { adminId, actionType } = req.query;

  const { actions, pagination } = await adminService.getAuditLog({
    page, limit, adminId, actionType,
  });

  return paginatedResponse(res, { message: 'Audit log fetched', data: actions, pagination });
}

module.exports = {
  getAnalytics,
  getUsers,
  getUserDetail,
  banUser,
  unbanUser,
  changeUserRole,
  updatePostStatus,
  deletePost,
  getPendingResources,
  reviewResource,
  verifyMentor,
  getAuditLog,
};
