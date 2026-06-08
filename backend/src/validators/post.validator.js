// src/validators/post.validator.js

const { z } = require('zod');

// ── POST /posts ───────────────────────────────────────────────
const createPostSchema = z.object({
  title: z
    .string()
    .min(10, 'Title must be at least 10 characters')
    .max(200, 'Title must be at most 200 characters')
    .trim(),
  body: z
    .string()
    .min(20, 'Body must be at least 20 characters')
    .max(10000, 'Body must be at most 10,000 characters')
    .trim(),
  isAnonymous: z.boolean().default(false),
  tagSlugs: z
    .array(z.string().max(50).trim().toLowerCase())
    .min(1, 'At least one tag is required')
    .max(5, 'Maximum 5 tags per post')
    .default([]),
});

// ── PATCH /posts/:id ─────────────────────────────────────────
const updatePostSchema = z.object({
  title: z
    .string()
    .min(10)
    .max(200)
    .trim()
    .optional(),
  body: z
    .string()
    .min(20)
    .max(10000)
    .trim()
    .optional(),
  isAnonymous: z.boolean().optional(),
  tagSlugs: z
    .array(z.string().max(50).trim().toLowerCase())
    .min(1)
    .max(5)
    .optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' },
);

// ── GET /posts — query filters ────────────────────────────────
const getPostsQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(50).default(20),
  search:  z.string().max(200).trim().optional(),
  tag:     z.string().max(50).optional(),
  sort:    z.enum(['trending', 'latest', 'top', 'unanswered']).default('trending'),
  author:  z.string().uuid().optional(),
  solved:  z.coerce.boolean().optional(),
  anonymous: z.coerce.boolean().optional(),
});

// ── GET /posts/:id/comments — query ──────────────────────────
const getPostCommentsQuerySchema = z.object({
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(50).default(20),
  sort:    z.enum(['top', 'latest', 'oldest']).default('top'),
});

// ── POST /posts/:id/solve ─────────────────────────────────────
const markSolvedSchema = z.object({
  commentId: z.string().uuid('Must be a valid comment UUID'),
});

// ── Shared UUID param ─────────────────────────────────────────
const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

const slugParamSchema = z.object({
  slug: z.string().min(1).max(300),
});

module.exports = {
  createPostSchema,
  updatePostSchema,
  getPostsQuerySchema,
  getPostCommentsQuerySchema,
  markSolvedSchema,
  uuidParamSchema,
  slugParamSchema,
};
