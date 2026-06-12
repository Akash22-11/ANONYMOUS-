// src/validators/resource.validator.js

const { z } = require('zod');

const RESOURCE_TYPES = ['PDF', 'NOTE', 'RESUME_TEMPLATE', 'ROADMAP', 'CHEATSHEET', 'LINK', 'VIDEO', 'OTHER'];
const YEARS          = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'ALUMNI'];

const uuidParam = z.object({ id: z.string().uuid('Invalid resource ID') });

// ─── Create resource ──────────────────────────────────────────
const createResourceSchema = z.object({
  title: z
    .string().trim()
    .min(5,  'Title must be at least 5 characters')
    .max(150, 'Title must be under 150 characters'),

  description: z
    .string().trim()
    .max(2000, 'Description must be under 2000 characters')
    .optional(),

  type: z.enum(RESOURCE_TYPES, {
    errorMap: () => ({ message: `Type must be one of: ${RESOURCE_TYPES.join(', ')}` }),
  }),

  externalUrl: z
    .string().url('Must be a valid URL')
    .optional()
    .or(z.literal('')),

  isAnonymous: z.boolean().default(false),
  college:     z.string().trim().max(100).optional(),
  department:  z.string().trim().max(100).optional(),
  year:        z.enum(YEARS).optional(),

  tagIds: z
    .array(z.string().uuid('Invalid tag ID'))
    .max(5, 'Maximum 5 tags per resource')
    .default([]),
}).refine(
  // LINK/VIDEO types must supply an externalUrl; file types get it from upload
  (d) => !['LINK', 'VIDEO'].includes(d.type) || (d.externalUrl && d.externalUrl.length > 0),
  { message: 'externalUrl is required for LINK and VIDEO resource types', path: ['externalUrl'] },
);

// ─── Update resource ──────────────────────────────────────────
const updateResourceSchema = z.object({
  title:       z.string().trim().min(5).max(150).optional(),
  description: z.string().trim().max(2000).optional(),
  isAnonymous: z.boolean().optional(),
  college:     z.string().trim().max(100).optional(),
  department:  z.string().trim().max(100).optional(),
  year:        z.enum(YEARS).optional(),
  tagIds:      z.array(z.string().uuid()).max(5).optional(),
}).strict();

// ─── Query filters ────────────────────────────────────────────
const getResourcesQuerySchema = z.object({
  page:       z.coerce.number().int().min(1).default(1),
  limit:      z.coerce.number().int().min(1).max(50).default(20),
  type:       z.enum(RESOURCE_TYPES).optional(),
  tag:        z.string().trim().optional(),
  college:    z.string().trim().optional(),
  department: z.string().trim().optional(),
  year:       z.enum(YEARS).optional(),
  search:     z.string().trim().max(100).optional(),
  sortBy:     z.enum(['newest', 'popular', 'downloads']).default('newest'),
  mine:       z.coerce.boolean().default(false),
});

module.exports = {
  createResourceSchema,
  updateResourceSchema,
  getResourcesQuerySchema,
  uuidParam,
};
