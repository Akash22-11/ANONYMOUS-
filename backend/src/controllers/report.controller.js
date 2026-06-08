// src/controllers/report.controller.js

const reportService = require('../services/report.service');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');

/**
 * @swagger
 * /reports:
 *   post:
 *     summary: Submit a report for a post, comment, resource, or user
 *     tags: [Reports]
 */
async function createReport(req, res) {
  const report = await reportService.createReport(req.user.id, req.body);
  return createdResponse(res, {
    message: 'Report submitted. Our moderation team will review it shortly.',
    data: { id: report.id, status: report.status },
  });
}

/**
 * @swagger
 * /reports/mine:
 *   get:
 *     summary: Get the current user's submitted reports
 *     tags: [Reports]
 */
async function getMyReports(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { reports, pagination } = await reportService.getMyReports(req.user.id, { page, limit });
  return paginatedResponse(res, { message: 'Your reports fetched', data: reports, pagination });
}

/**
 * @swagger
 * /reports:
 *   get:
 *     summary: List all reports (admin only)
 *     tags: [Reports]
 */
async function getReports(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { status, reason, targetType } = req.query;

  const { reports, pagination } = await reportService.getReports({
    page, limit, status, reason, targetType,
  });
  return paginatedResponse(res, { message: 'Reports fetched', data: reports, pagination });
}

/**
 * @swagger
 * /reports/{id}/resolve:
 *   patch:
 *     summary: Resolve or dismiss a report (admin only)
 *     tags: [Reports]
 */
async function resolveReport(req, res) {
  const report = await reportService.resolveReport(
    req.params.id,
    req.user.id,
    req.body,
  );
  return successResponse(res, { message: 'Report resolved', data: report });
}

module.exports = { createReport, getMyReports, getReports, resolveReport };
