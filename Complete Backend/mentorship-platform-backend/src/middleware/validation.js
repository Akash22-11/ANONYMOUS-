// src/middleware/validation.js — Zod schema validation middleware

const { AppError } = require('./error');
const { HTTP } = require('../constants/statusCodes');

/**
 * Validate req.body against a Zod schema
 * Replaces req.body with parsed + stripped output (strips unknown fields)
 */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
        code:    e.code,
      }));
      return next(new AppError('Validation failed', HTTP.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', errors));
    }
    req.body = result.data;
    return next();
  };
}

/**
 * Validate req.query against a Zod schema
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return next(new AppError('Invalid query parameters', HTTP.BAD_REQUEST, 'INVALID_QUERY', errors));
    }
    req.query = result.data;
    return next();
  };
}

/**
 * Validate req.params against a Zod schema
 */
function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return next(new AppError('Invalid URL parameters', HTTP.BAD_REQUEST, 'INVALID_PARAMS', errors));
    }
    req.params = result.data;
    return next();
  };
}

module.exports = { validateBody, validateQuery, validateParams };
