// src/validators/user.validator.js — Zod schemas for user/profile routes

const { z } = require('zod');

const urlSchema = z
  .string()
  .url('Must be a valid URL')
  .max(500)
  .optional()
  .nullable();

// ── PATCH /users/profile ─────────────────────────────────────
const updateProfileSchema = z.object({
  displayName:  z.string().min(2).max(50).trim().optional(),
  bio:          z.string().max(500, 'Bio must be at most 500 characters').trim().optional(),
  college:      z.string().min(2).max(100).trim().optional(),
  department:   z.string().min(2).max(100).trim().optional(),
  year:         z.enum(['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'ALUMNI']).optional(),
  skills:       z.array(z.string().max(50)).max(20, 'Maximum 20 skills').optional(),
  linkedinUrl:  urlSchema,
  githubUrl:    urlSchema,
  portfolioUrl: urlSchema,
  isProfilePublic: z.boolean().optional(),
}).strict();

// ── PUT /users/mentor-profile ────────────────────────────────
const updateMentorProfileSchema = z.object({
  headline:           z.string().min(5).max(150).trim().optional(),
  expertise:          z.array(z.string().max(50)).max(15).optional(),
  currentCompany:     z.string().max(100).trim().optional(),
  yearsOfExperience:  z.number().int().min(0).max(50).optional(),
  placementYear:      z.number().int().min(2000).max(new Date().getFullYear()).optional(),
  isAvailable:        z.boolean().optional(),
  maxWeeklySessions:  z.number().int().min(1).max(10).optional(),
  preferredSessionLen: z.number().int().min(15).max(120).optional(),
  sessionTopics:      z.array(z.string().max(100)).max(10).optional(),
}).strict();

// ── POST /users/mentor-availability ─────────────────────────
const availabilitySlotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM 24h format'),
  endTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be in HH:MM 24h format'),
}).refine(
  (data) => data.startTime < data.endTime,
  { message: 'End time must be after start time', path: ['endTime'] },
);

const upsertAvailabilitySchema = z.object({
  slots: z.array(availabilitySlotSchema).min(1).max(21), // max 3 slots × 7 days
});

// ── GET /users — query params ────────────────────────────────
const getUsersQuerySchema = z.object({
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(50).default(20),
  search:     z.string().max(100).optional(),
  role:       z.enum(['STUDENT', 'MENTOR']).optional(),
  college:    z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  year:       z.enum(['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'ALUMNI']).optional(),
  sortBy:     z.enum(['reputation', 'createdAt', 'name']).default('reputation'),
  order:      z.enum(['asc', 'desc']).default('desc'),
});

// ── UUID param validator ─────────────────────────────────────
const uuidParamSchema = z.object({
  id: z.string().uuid('Invalid ID format'),
});

module.exports = {
  updateProfileSchema,
  updateMentorProfileSchema,
  upsertAvailabilitySchema,
  getUsersQuerySchema,
  uuidParamSchema,
};
