// src/utils/response.js — Standardized JSON response helpers

const { HTTP } = require('../constants/statusCodes');

/**
 * Success response
 * { success: true, message, data, meta }
 */
function successResponse(res, { message = 'Success', data = null, statusCode = HTTP.OK, meta = null } = {}) {
  const body = { success: true, message };
  if (data !== null)  body.data = data;
  if (meta !== null)  body.meta = meta;
  return res.status(statusCode).json(body);
}

/**
 * Created response (201)
 */
function createdResponse(res, { message = 'Created', data = null } = {}) {
  return successResponse(res, { message, data, statusCode: HTTP.CREATED });
}

/**
 * Error response
 * { success: false, message, errors? }
 */
function errorResponse(res, { message = 'An error occurred', errors = null, statusCode = HTTP.INTERNAL_SERVER_ERROR } = {}) {
  const body = { success: false, message };
  if (errors !== null) body.errors = errors;
  return res.status(statusCode).json(body);
}

/**
 * Paginated response helper
 */
function paginatedResponse(res, { message = 'Success', data, pagination } = {}) {
  return successResponse(res, { message, data, meta: { pagination } });
}

/**
 * No content (204)
 */
function noContentResponse(res) {
  return res.status(HTTP.NO_CONTENT).send();
}

module.exports = {
  successResponse,
  createdResponse,
  errorResponse,
  paginatedResponse,
  noContentResponse,
};
