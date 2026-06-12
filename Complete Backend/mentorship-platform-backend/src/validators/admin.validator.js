// src/validators/admin.validator.js

const { z } = require('zod');

const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });

// ─── Ban / unban user ─────────────────────────────────────────
const banUserSchema = z.object({
  reason: z
    .string().trim()
    .min(10, 'Please provide a reason of at least 10 characters')
    .max(500, 'Reason must be under 500 characters'),
  permanent: z.boolean().default(false),
});

// ─── Update post status ───────────────────────────────────────
const updatePostStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED', 'REMOVED', 'PENDING_REVIEW'], {
    errorMap: () => ({ message: 'Invalid post status' }),
  }),
  reason: z.string().trim().max(300).optional(),
});

// ─── Approve / reject resource ────────────────────────────────
const reviewResourceSchema = z.object({
  approved: z.boolean(),
  reason:   z.string().trim().max(300).optional(),
});

// ─── Change user role ─────────────────────────────────────────
const changeUserRoleSchema = z.object({
  role: z.enum(['STUDENT', 'MENTOR', 'ADMIN'], {
    errorMap: () => ({ message: 'Role must be STUDENT, MENTOR, or ADMIN' }),
  }),
});

// ─── Verify mentor ────────────────────────────────────────────
const verifyMentorSchema = z.object({
  verified: z.boolean(),
  reason:   z.string().trim().max(300).optional(),
});

// ─── Analytics query ──────────────────────────────────────────
const analyticsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
});

// ─── Admin user list filters ──────────────────────────────────
const adminUsersQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  role:    z.enum(['STUDENT', 'MENTOR', 'ADMIN', 'SUPER_ADMIN']).optional(),
  banned:  z.coerce.boolean().optional(),
  search:  z.string().trim().max(100).optional(),
  sortBy:  z.enum(['newest', 'reputation', 'activity']).default('newest'),
});

module.exports = {
  banUserSchema,
  updatePostStatusSchema,
  reviewResourceSchema,
  changeUserRoleSchema,
  verifyMentorSchema,
  analyticsQuerySchema,
  adminUsersQuerySchema,
  uuidParam,
};
