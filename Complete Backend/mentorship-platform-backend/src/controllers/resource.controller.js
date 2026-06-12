// src/controllers/resource.controller.js

const resourceService = require('../services/resource.service');
const {
  successResponse, createdResponse,
  paginatedResponse, noContentResponse,
} = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');
const { AppError } = require('../middleware/error');
const { HTTP }     = require('../constants/statusCodes');
const { autoReportFlagged } = require('../middleware/toxicity');

/**
 * @swagger
 * /resources:
 *   get:
 *     summary: List approved resources with filters
 *     tags: [Resources]
 */
async function getResources(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { type, tag, college, department, year, search, sortBy, mine } = req.query;

  const { resources, pagination } = await resourceService.getResources({
    page, limit, type, tag, college, department, year, search,
    sortBy:     sortBy  ?? 'newest',
    mine:       mine === 'true',
    requesterId: req.user?.id ?? null,
  });

  return paginatedResponse(res, { message: 'Resources fetched', data: resources, pagination });
}

/**
 * @swagger
 * /resources/{id}:
 *   get:
 *     summary: Get a single resource by ID
 *     tags: [Resources]
 */
async function getResourceById(req, res) {
  const resource = await resourceService.getResourceById(
    req.params.id,
    req.user?.id ?? null,
  );
  return successResponse(res, { message: 'Resource fetched', data: resource });
}

/**
 * @swagger
 * /resources/{id}/download:
 *   get:
 *     summary: Get the download URL and increment the download counter
 *     tags: [Resources]
 */
async function downloadResource(req, res) {
  const resource = await resourceService.getResourceById(
    req.params.id,
    req.user?.id ?? null,
  );

  const url = resource.fileUrl ?? resource.externalUrl;
  if (!url) throw new AppError('No file available for this resource', HTTP.NOT_FOUND);

  // Async counter — never blocks the redirect
  resourceService.trackDownload(resource.id).catch(() => {});

  return successResponse(res, {
    message:  'Download URL generated',
    data:     { url, fileName: resource.title },
  });
}

/**
 * @swagger
 * /resources:
 *   post:
 *     summary: Upload a new resource
 *     tags: [Resources]
 */
async function createResource(req, res) {
  const fileBuffer = req.file?.buffer ?? null;

  const resource = await resourceService.createResource(
    req.user.id,
    req.body,
    fileBuffer,
  );

  if (req.toxicityFlag?.isFlagged) {
    autoReportFlagged({ reporterId: req.user.id, resourceId: resource.id }).catch(() => {});
  }

  return createdResponse(res, {
    message: 'Resource submitted for review. It will be visible after admin approval.',
    data:    resource,
  });
}

/**
 * @swagger
 * /resources/{id}:
 *   patch:
 *     summary: Update a resource (owner only)
 *     tags: [Resources]
 */
async function updateResource(req, res) {
  const resource = await resourceService.updateResource(
    req.params.id,
    req.user.id,
    req.body,
  );
  return successResponse(res, { message: 'Resource updated', data: resource });
}

/**
 * @swagger
 * /resources/{id}:
 *   delete:
 *     summary: Delete a resource (owner or admin)
 *     tags: [Resources]
 */
async function deleteResource(req, res) {
  await resourceService.deleteResource(req.params.id, req.user.id, req.user.role);
  return successResponse(res, { message: 'Resource deleted' });
}

module.exports = {
  getResources,
  getResourceById,
  downloadResource,
  createResource,
  updateResource,
  deleteResource,
};
