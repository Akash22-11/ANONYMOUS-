// src/middleware/error.js — Global error handler + AppError class

const { logger } = require('../utils/logger');
const { HTTP } = require('../constants/statusCodes');

// ─── Custom error class ───────────────────────────────────────

class AppError extends Error {
  constructor(message, statusCode = HTTP.INTERNAL_SERVER_ERROR, code = null, errors = null) {
    super(message);
    this.name       = 'AppError';
    this.statusCode = statusCode;
    this.code       = code;     // Machine-readable error code, e.g. 'OTP_INVALID'
    this.errors     = errors;   // Field-level validation errors
    this.isOperational = true;  // vs programmer errors
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = null, errors = null) {
    return new AppError(message, HTTP.BAD_REQUEST, code, errors);
  }
  static unauthorized(message = 'Unauthorized', code = null) {
    return new AppError(message, HTTP.UNAUTHORIZED, code);
  }
  static forbidden(message = 'Forbidden', code = null) {
    return new AppError(message, HTTP.FORBIDDEN, code);
  }
  static notFound(message = 'Resource not found', code = null) {
    return new AppError(message, HTTP.NOT_FOUND, code);
  }
  static conflict(message, code = null) {
    return new AppError(message, HTTP.CONFLICT, code);
  }
  static tooManyRequests(message = 'Too many requests', code = null) {
    return new AppError(message, HTTP.TOO_MANY_REQUESTS, code);
  }
  static internal(message = 'Internal server error') {
    return new AppError(message, HTTP.INTERNAL_SERVER_ERROR);
  }
}

// ─── Prisma error mapper ──────────────────────────────────────

function handlePrismaError(err) {
  switch (err.code) {
    case 'P2002': { // Unique constraint failed
      const field = err.meta?.target?.[0] ?? 'field';
      return new AppError(`A record with this ${field} already exists`, HTTP.CONFLICT, 'DUPLICATE_ENTRY');
    }
    case 'P2025': // Record not found
      return new AppError('Record not found', HTTP.NOT_FOUND, 'NOT_FOUND');
    case 'P2003': // Foreign key constraint
      return new AppError('Related record not found', HTTP.BAD_REQUEST, 'FK_CONSTRAINT');
    case 'P2014': // Required relation violation
      return new AppError('Invalid relation', HTTP.BAD_REQUEST, 'INVALID_RELATION');
    default:
      return new AppError('Database operation failed', HTTP.INTERNAL_SERVER_ERROR, 'DB_ERROR');
  }
}

// ─── Global error handler middleware ─────────────────────────

function globalErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let error = err;

  // Map Prisma errors
  if (err.constructor?.name === 'PrismaClientKnownRequestError') {
    error = handlePrismaError(err);
  }

  // Map Zod validation errors
  if (err.name === 'ZodError') {
    const errors = err.errors.map((e) => ({
      field:   e.path.join('.'),
      message: e.message,
    }));
    error = new AppError('Validation failed', HTTP.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', errors);
  }

  // Map JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', HTTP.UNAUTHORIZED, 'INVALID_TOKEN');
  }
  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', HTTP.UNAUTHORIZED, 'TOKEN_EXPIRED');
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new AppError(`File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB ?? 10}MB`, HTTP.BAD_REQUEST, 'FILE_TOO_LARGE');
  }

  const statusCode = error.statusCode ?? HTTP.INTERNAL_SERVER_ERROR;
  const isOperational = error.isOperational ?? false;

  // Log non-operational errors as errors; operational ones as warnings
  if (!isOperational || statusCode >= 500) {
    logger.error({
      message: error.message,
      stack:   error.stack,
      url:     req.originalUrl,
      method:  req.method,
      userId:  req.user?.id,
      code:    error.code,
    });
  } else {
    logger.warn(`[${statusCode}] ${error.message} — ${req.method} ${req.originalUrl}`);
  }

  const body = {
    success: false,
    message: error.message,
    code:    error.code ?? null,
  };

  if (error.errors) body.errors = error.errors;

  // Only include stack in development
  if (process.env.NODE_ENV === 'development') {
    body.stack = error.stack;
  }

  return res.status(statusCode).json(body);
}

/**
 * 404 handler — mount after all routes
 */
function notFoundHandler(req, res) {
  return res.status(HTTP.NOT_FOUND).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code:    'ROUTE_NOT_FOUND',
  });
}

module.exports = { AppError, globalErrorHandler, notFoundHandler };
