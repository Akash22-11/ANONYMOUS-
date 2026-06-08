// src/validators/comment.validator.js

const { z } = require('zod');

// ── POST /posts/:id/comments ──────────────────────────────────
const createCommentSchema = z.object({
  body: z
    .string()
    .min(2, 'Comment must be at least 2 characters')
    .max(5000, 'Comment must be at most 5,000 characters')
    .trim(),
  parentId:    z.string().uuid('Parent ID must be a valid UUID').optional().nullable(),
  isAnonymous: z.boolean().default(false),
});

// ── PATCH /comments/:id ───────────────────────────────────────
const updateCommentSchema = z.object({
  body: z
    .string()
    .min(2)
    .max(5000)
    .trim(),
});

// ── GET /comments query ───────────────────────────────────────
const getCommentsQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort:  z.enum(['top', 'latest', 'oldest']).default('top'),
});

// ── POST /votes ───────────────────────────────────────────────
const voteSchema = z.object({
  targetType: z.enum(['post', 'comment'], { required_error: 'targetType must be "post" or "comment"' }),
  targetId:   z.string().uuid('targetId must be a valid UUID'),
  voteType:   z.enum(['UPVOTE', 'DOWNVOTE'], { required_error: 'voteType must be UPVOTE or DOWNVOTE' }),
});

// ── POST /reports ─────────────────────────────────────────────
const createReportSchema = z.object({
  reason: z.enum([
    'SPAM',
    'HARASSMENT',
    'OFFENSIVE_CONTENT',
    'MISINFORMATION',
    'PLAGIARISM',
    'INAPPROPRIATE',
    'OTHER',
  ]),
  description: z
    .string()
    .max(1000, 'Description must be at most 1,000 characters')
    .trim()
    .optional(),
  targetType: z.enum(['post', 'comment', 'resource', 'user']),
  targetId:   z.string().uuid('targetId must be a valid UUID'),
});

// ── Shared UUID param ─────────────────────────────────────────
const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

module.exports = {
  createCommentSchema,
  updateCommentSchema,
  getCommentsQuerySchema,
  voteSchema,
  createReportSchema,
  uuidParamSchema,
};
