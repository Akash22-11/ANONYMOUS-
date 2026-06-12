// src/middleware/admin.js — Role-based access control middleware

const { ROLES, ADMIN_ROLES, MENTOR_ROLES, hasMinimumRole } = require('../constants/roles');
const { HTTP } = require('../constants/statusCodes');
const { errorResponse } = require('../utils/response');

/**
 * Factory: require a specific role or higher
 * Usage: requireRole('ADMIN')
 */
function requireRole(minimumRole) {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, { message: 'Authentication required', statusCode: HTTP.UNAUTHORIZED });
    }
    if (!hasMinimumRole(req.user.role, minimumRole)) {
      return errorResponse(res, {
        message: `This action requires ${minimumRole} access or higher`,
        statusCode: HTTP.FORBIDDEN,
      });
    }
    return next();
  };
}

/**
 * Convenience: require ADMIN or SUPER_ADMIN
 */
const requireAdmin = requireRole(ROLES.ADMIN);

/**
 * Convenience: require SUPER_ADMIN only
 */
const requireSuperAdmin = requireRole(ROLES.SUPER_ADMIN);

/**
 * Convenience: require MENTOR role or higher
 */
const requireMentor = requireRole(ROLES.MENTOR);

/**
 * Allow resource owner OR admin
 * Usage: requireOwnerOrAdmin('authorId') — checks req.resource[field] === req.user.id
 */
function requireOwnerOrAdmin(ownerField = 'userId') {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, { message: 'Authentication required', statusCode: HTTP.UNAUTHORIZED });
    }

    const resource = req.resource; // set by prior middleware that loads the entity
    if (!resource) {
      return errorResponse(res, { message: 'Resource not found', statusCode: HTTP.NOT_FOUND });
    }

    const ownerId = resource[ownerField];
    const isOwner = ownerId === req.user.id;
    const isAdmin = ADMIN_ROLES.includes(req.user.role);

    if (!isOwner && !isAdmin) {
      return errorResponse(res, {
        message: 'You do not have permission to perform this action',
        statusCode: HTTP.FORBIDDEN,
      });
    }
    return next();
  };
}

module.exports = { requireRole, requireAdmin, requireSuperAdmin, requireMentor, requireOwnerOrAdmin };
