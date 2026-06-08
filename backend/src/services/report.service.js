// src/services/report.service.js — Content moderation reports

const { prisma }   = require('../config/db');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { buildPaginationMeta } = require('../utils/pagination');
const { logger }   = require('../utils/logger');

const REPORT_SELECT = {
  id: true, reason: true, description: true, status: true,
  resolvedBy: true, resolvedAt: true, resolution: true,
  targetUserId: true, postId: true, commentId: true, resourceId: true,
  createdAt: true, updatedAt: true,
  reporter: {
    select: { id: true, username: true, anonymousAlias: true },
  },
  post:     { select: { id: true, title: true, slug: true } },
  comment:  { select: { id: true, body: true, postId: true } },
  targetUser: { select: { id: true, username: true } },
};

// ─────────────────────────────────────────────────────────────
// createReport
// ─────────────────────────────────────────────────────────────
async function createReport(reporterId, { reason, description, targetType, targetId }) {
  // Prevent self-reporting
  if (targetType === 'user' && targetId === reporterId) {
    throw new AppError('You cannot report yourself', HTTP.BAD_REQUEST, 'SELF_REPORT');
  }

  // Verify the target actually exists
  await verifyTarget(targetType, targetId);

  // Check for duplicate pending report from same user on same target
  const duplicateWhere = buildTargetWhere(targetType, targetId);
  const duplicate = await prisma.report.findFirst({
    where: { reporterId, status: 'PENDING', ...duplicateWhere },
  });
  if (duplicate) {
    throw new AppError(
      'You have already reported this content. Our team is reviewing it.',
      HTTP.CONFLICT,
      'DUPLICATE_REPORT',
    );
  }

  const report = await prisma.report.create({
    data: {
      reporterId,
      reason,
      description: description ?? null,
      status: 'PENDING',
      ...buildTargetWhere(targetType, targetId),
    },
    select: REPORT_SELECT,
  });

  logger.info(`Report created: ${report.id} — ${targetType}:${targetId} by user:${reporterId}`);
  return report;
}

// ─────────────────────────────────────────────────────────────
// getReports — admin paginated list with filters
// ─────────────────────────────────────────────────────────────
async function getReports({ page, limit, status, reason, targetType }) {
  const skip = (page - 1) * limit;

  const where = {
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
  };

  // Filter by target type
  if (targetType === 'post')     where.postId     = { not: null };
  if (targetType === 'comment')  where.commentId  = { not: null };
  if (targetType === 'user')     where.targetUserId = { not: null };
  if (targetType === 'resource') where.resourceId = { not: null };

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where,
      select:  REPORT_SELECT,
      orderBy: { createdAt: 'desc' },
      skip,
      take:    limit,
    }),
    prisma.report.count({ where }),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit, data: reports });
  return { reports, pagination };
}

// ─────────────────────────────────────────────────────────────
// resolveReport — admin action
// ─────────────────────────────────────────────────────────────
async function resolveReport(reportId, adminId, { status, resolution }) {
  const report = await prisma.report.findUnique({
    where:  { id: reportId },
    select: { id: true, status: true },
  });

  if (!report) throw new AppError('Report not found', HTTP.NOT_FOUND);
  if (report.status === 'RESOLVED' || report.status === 'DISMISSED') {
    throw new AppError('Report is already closed', HTTP.CONFLICT, 'REPORT_CLOSED');
  }

  const updated = await prisma.report.update({
    where: { id: reportId },
    data:  {
      status,
      resolution:  resolution ?? null,
      resolvedBy:  adminId,
      resolvedAt:  new Date(),
    },
    select: REPORT_SELECT,
  });

  // Log admin action
  await prisma.adminAction.create({
    data: {
      adminId,
      actionType: 'resolve_report',
      targetType: 'report',
      targetId:   reportId,
      reason:     resolution,
      metadata:   { newStatus: status },
    },
  }).catch(() => {});

  return updated;
}

// ─────────────────────────────────────────────────────────────
// getMyReports — what the current user has reported
// ─────────────────────────────────────────────────────────────
async function getMyReports(reporterId, { page, limit }) {
  const skip = (page - 1) * limit;

  const [reports, total] = await Promise.all([
    prisma.report.findMany({
      where:   { reporterId },
      select:  {
        id: true, reason: true, status: true, createdAt: true,
        postId: true, commentId: true, targetUserId: true, resourceId: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take:    limit,
    }),
    prisma.report.count({ where: { reporterId } }),
  ]);

  const pagination = buildPaginationMeta({ total, page, limit, data: reports });
  return { reports, pagination };
}

// ─── Internal helpers ─────────────────────────────────────────

function buildTargetWhere(targetType, targetId) {
  switch (targetType) {
    case 'post':     return { postId:      targetId };
    case 'comment':  return { commentId:   targetId };
    case 'user':     return { targetUserId: targetId };
    case 'resource': return { resourceId:  targetId };
    default:         throw new AppError('Invalid target type', HTTP.BAD_REQUEST);
  }
}

async function verifyTarget(targetType, targetId) {
  let exists;
  switch (targetType) {
    case 'post':
      exists = await prisma.post.findFirst({ where: { id: targetId, deletedAt: null } });
      break;
    case 'comment':
      exists = await prisma.comment.findFirst({ where: { id: targetId, deletedAt: null } });
      break;
    case 'user':
      exists = await prisma.user.findFirst({ where: { id: targetId, deletedAt: null, isActive: true } });
      break;
    case 'resource':
      exists = await prisma.resource.findFirst({ where: { id: targetId, deletedAt: null } });
      break;
    default:
      throw new AppError('Invalid target type', HTTP.BAD_REQUEST);
  }
  if (!exists) {
    throw new AppError(`${targetType} not found`, HTTP.NOT_FOUND);
  }
}

module.exports = { createReport, getReports, resolveReport, getMyReports };
