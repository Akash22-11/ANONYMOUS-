// src/utils/pagination.js — Cursor and offset pagination helpers

const DEFAULT_PAGE  = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT     = 100;

/**
 * Parse pagination query params from request
 * Supports both offset (?page=2&limit=10) and cursor (?cursor=<id>&limit=10)
 */
function parsePaginationParams(query) {
  const limit  = Math.min(Math.max(parseInt(query.limit ?? DEFAULT_LIMIT, 10), 1), MAX_LIMIT);
  const page   = Math.max(parseInt(query.page ?? DEFAULT_PAGE, 10), 1);
  const cursor = query.cursor ?? null;
  const skip   = cursor ? undefined : (page - 1) * limit;

  return { limit, page, skip, cursor };
}

/**
 * Build the Prisma `findMany` args for offset pagination
 */
function buildOffsetPaginationArgs({ page, limit }) {
  const skip = (page - 1) * limit;
  return { skip, take: limit };
}

/**
 * Build the Prisma `findMany` args for cursor pagination
 */
function buildCursorPaginationArgs({ cursor, limit }) {
  const args = { take: limit };
  if (cursor) {
    args.cursor = { id: cursor };
    args.skip   = 1; // skip the cursor itself
  }
  return args;
}

/**
 * Build pagination metadata for response
 */
function buildPaginationMeta({ total, page, limit, data }) {
  const totalPages  = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;
  const nextCursor  = data.length > 0 ? data[data.length - 1].id : null;

  return {
    total,
    page,
    limit,
    totalPages,
    hasNextPage,
    hasPrevPage,
    nextCursor,
  };
}

/**
 * Build cursor-based pagination metadata
 */
function buildCursorMeta({ data, limit }) {
  return {
    limit,
    hasNextPage: data.length === limit,
    nextCursor:  data.length === limit ? data[data.length - 1].id : null,
  };
}

module.exports = {
  parsePaginationParams,
  buildOffsetPaginationArgs,
  buildCursorPaginationArgs,
  buildPaginationMeta,
  buildCursorMeta,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
