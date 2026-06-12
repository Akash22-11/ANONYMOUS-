// src/services/resource.service.js

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');
const { uploadResource, deleteFromCloudinary } = require('../utils/cloudinaryUpload');
const { logger }   = require('../utils/logger');

// ─── Field selectors ──────────────────────────────────────────
const RESOURCE_SELECT = {
  id: true, title: true, description: true, type: true,
  fileUrl: true, fileSize: true, mimeType: true, externalUrl: true,
  isAnonymous: true, isApproved: true,
  downloadCount: true, viewCount: true,
  college: true, department: true, year: true,
  createdAt: true, updatedAt: true,
  uploader: {
    select: { id: true, username: true, anonymousAlias: true,
      profile: { select: { displayName: true, avatarUrl: true } } },
  },
  tags: { select: { tag: { select: { id: true, name: true, slug: true, color: true } } } },
};

// ─────────────────────────────────────────────────────────────
// getResources — filterable public list (approved only)
// ─────────────────────────────────────────────────────────────
async function getResources({
  page, limit, type, tag, college, department, year,
  search, sortBy, mine, requesterId,
}) {
  const skip  = (page - 1) * limit;

  const where = {
    deletedAt: null,
    // Show only approved unless listing your own resources
    ...(mine && requesterId ? { uploaderId: requesterId } : { isApproved: true }),
  };

  if (type)       where.type       = type;
  if (college)    where.college    = { contains: college,    mode: 'insensitive' };
  if (department) where.department = { contains: department, mode: 'insensitive' };
  if (year)       where.year       = year;

  if (tag) {
    where.tags = { some: { tag: { slug: tag } } };
  }

  if (search) {
    where.OR = [
      { title:       { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const orderBy = {
    newest:    { createdAt:     'desc' },
    popular:   { viewCount:     'desc' },
    downloads: { downloadCount: 'desc' },
  }[sortBy] ?? { createdAt: 'desc' };

  const [resources, total] = await Promise.all([
    prisma.resource.findMany({
      where, select: RESOURCE_SELECT, orderBy, skip, take: limit,
    }),
    prisma.resource.count({ where }),
  ]);

  const data = resources.map(formatResource);
  return { resources: data, pagination: buildPaginationMeta({ total, page, limit, data }) };
}

// ─────────────────────────────────────────────────────────────
// getResourceById
// ─────────────────────────────────────────────────────────────
async function getResourceById(id, requesterId = null) {
  const resource = await prisma.resource.findFirst({
    where: { id, deletedAt: null },
    select: RESOURCE_SELECT,
  });

  if (!resource) throw new AppError('Resource not found', HTTP.NOT_FOUND);

  // Non-approved resources only visible to their uploader or admins
  if (!resource.isApproved) {
    if (!requesterId || resource.uploader.id !== requesterId) {
      throw new AppError('Resource not found', HTTP.NOT_FOUND);
    }
  }

  // Async view count increment — never blocks response
  prisma.resource.update({
    where: { id },
    data:  { viewCount: { increment: 1 } },
  }).catch(() => {});

  return formatResource(resource);
}

// ─────────────────────────────────────────────────────────────
// createResource — handles file upload + metadata
// ─────────────────────────────────────────────────────────────
async function createResource(uploaderId, data, fileBuffer = null) {
  const { title, description, type, externalUrl, isAnonymous, college, department, year, tagIds } = data;

  // File types require an uploaded file
  const FILE_TYPES = ['PDF', 'NOTE', 'RESUME_TEMPLATE', 'ROADMAP', 'CHEATSHEET', 'OTHER'];
  let fileUrl = null, filePublicId = null, fileSize = null, mimeType = null;

  if (FILE_TYPES.includes(type)) {
    if (!fileBuffer) {
      throw new AppError('A file upload is required for this resource type', HTTP.BAD_REQUEST, 'FILE_REQUIRED');
    }
    try {
      const uploaded = await uploadResource(fileBuffer, uploaderId);
      fileUrl       = uploaded.url;
      filePublicId  = uploaded.publicId;
      fileSize      = fileBuffer.length;
      mimeType      = uploaded.format ? `application/${uploaded.format}` : 'application/octet-stream';
    } catch (err) {
      throw new AppError(`File upload failed: ${err.message}`, HTTP.INTERNAL_SERVER_ERROR, 'UPLOAD_FAILED');
    }
  }

  // Resolve tag IDs — ignore any that don't exist
  const validTags = tagIds?.length
    ? await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true } })
    : [];

  const resource = await prisma.$transaction(async (tx) => {
    const r = await tx.resource.create({
      data: {
        uploaderId, title, description: description ?? null,
        type, fileUrl, filePublicId, fileSize, mimeType,
        externalUrl: externalUrl ?? null,
        isAnonymous: isAnonymous ?? false,
        isApproved:  false, // admin must approve
        college:     college    ?? null,
        department:  department ?? null,
        year:        year       ?? null,
        tags: validTags.length
          ? { create: validTags.map(t => ({ tagId: t.id })) }
          : undefined,
      },
      select: RESOURCE_SELECT,
    });

    // Increment usage counts for selected tags
    if (validTags.length) {
      await tx.tag.updateMany({
        where: { id: { in: validTags.map(t => t.id) } },
        data:  { usageCount: { increment: 1 } },
      });
    }

    return r;
  });

  logger.info(`Resource created: ${resource.id} by user:${uploaderId} (pending approval)`);
  return formatResource(resource);
}

// ─────────────────────────────────────────────────────────────
// updateResource — owner only
// ─────────────────────────────────────────────────────────────
async function updateResource(id, uploaderId, updates) {
  const resource = await prisma.resource.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, uploaderId: true, tags: { select: { tagId: true } } },
  });

  if (!resource) throw new AppError('Resource not found', HTTP.NOT_FOUND);
  if (resource.uploaderId !== uploaderId) {
    throw new AppError('You can only edit your own resources', HTTP.FORBIDDEN);
  }

  const { tagIds, ...rest } = updates;

  const updated = await prisma.$transaction(async (tx) => {
    // Re-sync tags if provided
    if (tagIds !== undefined) {
      const validTags = await tx.tag.findMany({
        where: { id: { in: tagIds } }, select: { id: true },
      });

      // Remove old tag relations
      await tx.resourceTag.deleteMany({ where: { resourceId: id } });

      // Decrement old tag counts
      const oldTagIds = resource.tags.map(t => t.tagId);
      if (oldTagIds.length) {
        await tx.tag.updateMany({
          where: { id: { in: oldTagIds } },
          data:  { usageCount: { decrement: 1 } },
        });
      }

      // Add new tags
      if (validTags.length) {
        await tx.resourceTag.createMany({
          data: validTags.map(t => ({ resourceId: id, tagId: t.id })),
        });
        await tx.tag.updateMany({
          where: { id: { in: validTags.map(t => t.id) } },
          data:  { usageCount: { increment: 1 } },
        });
      }
    }

    return tx.resource.update({
      where: { id },
      data:  rest,
      select: RESOURCE_SELECT,
    });
  });

  return formatResource(updated);
}

// ─────────────────────────────────────────────────────────────
// deleteResource — soft delete, also cleans up Cloudinary
// ─────────────────────────────────────────────────────────────
async function deleteResource(id, requesterId, requesterRole) {
  const resource = await prisma.resource.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, uploaderId: true, filePublicId: true },
  });

  if (!resource) throw new AppError('Resource not found', HTTP.NOT_FOUND);

  const isOwner = resource.uploaderId === requesterId;
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(requesterRole);

  if (!isOwner && !isAdmin) {
    throw new AppError('You do not have permission to delete this resource', HTTP.FORBIDDEN);
  }

  await prisma.resource.update({
    where: { id },
    data:  { deletedAt: new Date() },
  });

  // Async Cloudinary cleanup
  if (resource.filePublicId) {
    deleteFromCloudinary(resource.filePublicId, 'raw').catch((err) =>
      logger.error(`Cloudinary delete failed for resource ${id}: ${err.message}`),
    );
  }
}

// ─────────────────────────────────────────────────────────────
// trackDownload — increment counter on file download
// ─────────────────────────────────────────────────────────────
async function trackDownload(id) {
  await prisma.resource.update({
    where: { id },
    data:  { downloadCount: { increment: 1 } },
  }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────
// approveResource — admin action
// ─────────────────────────────────────────────────────────────
async function approveResource(id, adminId, { approved, reason }) {
  const resource = await prisma.resource.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, isApproved: true, uploaderId: true },
  });

  if (!resource) throw new AppError('Resource not found', HTTP.NOT_FOUND);

  const updated = await prisma.resource.update({
    where: { id },
    data:  { isApproved: approved },
    select: RESOURCE_SELECT,
  });

  // Admin audit log
  await prisma.adminAction.create({
    data: {
      adminId,
      actionType: approved ? 'approve_resource' : 'reject_resource',
      targetType: 'resource',
      targetId:   id,
      reason:     reason ?? null,
    },
  }).catch(() => {});

  return formatResource(updated);
}

// ─── Format helper — flatten tags array ──────────────────────
function formatResource(r) {
  return {
    ...r,
    tags: r.tags?.map(t => t.tag) ?? [],
    uploader: r.isAnonymous
      ? { id: r.uploader?.id, anonymousAlias: r.uploader?.anonymousAlias }
      : r.uploader,
  };
}

module.exports = {
  getResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
  trackDownload,
  approveResource,
};
