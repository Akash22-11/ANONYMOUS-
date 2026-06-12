// src/validators/mentor.validator.js

const { z } = require('zod');

// ─── Shared ───────────────────────────────────────────────────
const uuidParam = z.object({ id: z.string().uuid('Invalid ID') });

// ─── Mentor request ───────────────────────────────────────────
const createMentorRequestSchema = z.object({
  mentorProfileId: z.string().uuid('Invalid mentor profile ID'),
  topic: z
    .string()
    .trim()
    .min(5,  'Topic must be at least 5 characters')
    .max(120, 'Topic must be under 120 characters'),
  description: z
    .string()
    .trim()
    .min(20,  'Please describe your request in at least 20 characters')
    .max(1000, 'Description must be under 1000 characters'),
  scheduledAt: z
    .string()
    .datetime({ message: 'scheduledAt must be an ISO 8601 datetime' })
    .optional()
    .refine(
      (v) => !v || new Date(v) > new Date(),
      'Scheduled time must be in the future',
    ),
  isAnonymous: z.boolean().default(false),
});

// ─── Accept / decline ─────────────────────────────────────────
const respondToRequestSchema = z.object({
  action:       z.enum(['accept', 'decline']),
  scheduledAt:  z
    .string()
    .datetime()
    .optional()
    .refine((v) => !v || new Date(v) > new Date(), 'Scheduled time must be in the future'),
  declineReason: z
    .string()
    .trim()
    .max(300, 'Decline reason must be under 300 characters')
    .optional(),
}).refine(
  (data) => data.action !== 'accept' || data.scheduledAt,
  { message: 'scheduledAt is required when accepting', path: ['scheduledAt'] },
);

// ─── Session feedback ─────────────────────────────────────────
const sessionFeedbackSchema = z.object({
  feedbackRating: z
    .number()
    .int()
    .min(1, 'Rating must be between 1 and 5')
    .max(5, 'Rating must be between 1 and 5'),
  feedbackText: z
    .string()
    .trim()
    .max(1000, 'Feedback must be under 1000 characters')
    .optional(),
});

// ─── Mentor request list filters ─────────────────────────────
const getMentorRequestsQuerySchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
  status: z
    .enum(['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'COMPLETED'])
    .optional(),
  role:   z.enum(['mentor', 'mentee']).default('mentee'),
});

// ─── Mentor browse filters ────────────────────────────────────
const getMentorsQuerySchema = z.object({
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(50).default(20),
  expertise:  z.string().trim().optional(),
  company:    z.string().trim().optional(),
  available:  z.coerce.boolean().optional(),
  search:     z.string().trim().max(80).optional(),
  sortBy:     z.enum(['rating', 'sessions', 'recent']).default('rating'),
});

module.exports = {
  createMentorRequestSchema,
  respondToRequestSchema,
  sessionFeedbackSchema,
  getMentorRequestsQuerySchema,
  getMentorsQuerySchema,
  uuidParam,
};
