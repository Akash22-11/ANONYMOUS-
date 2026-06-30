// src/constants/roles.js

const ROLES = Object.freeze({
  STUDENT:     'STUDENT',
  MENTOR:      'MENTOR',
  ADMIN:       'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
});

// Hierarchy level — higher = more permissions
const ROLE_LEVEL = Object.freeze({
  STUDENT:     1,
  MENTOR:      2,
  ADMIN:       3,
  SUPER_ADMIN: 4,
});

// Which roles can access admin routes
const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

// Which roles can act as mentors
const MENTOR_ROLES = [ROLES.MENTOR, ROLES.ADMIN, ROLES.SUPER_ADMIN];

function hasMinimumRole(role, requiredRole) {
  return (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[requiredRole] ?? 0);
}

module.exports = { ROLES, ROLE_LEVEL, ADMIN_ROLES, MENTOR_ROLES, hasMinimumRole };
