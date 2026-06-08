// src/middleware/upload.js — Multer configuration for file uploads

const multer = require('multer');
const path   = require('path');
const { AppError } = require('./error');
const { HTTP } = require('../constants/statusCodes');

const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB ?? '10', 10);
const MAX_FILE_SIZE    = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_IMAGE_MIMES = (process.env.ALLOWED_IMAGE_TYPES ?? 'image/jpeg,image/png,image/webp,image/gif')
  .split(',').map((t) => t.trim());

const ALLOWED_DOC_MIMES = (process.env.ALLOWED_DOC_TYPES ?? 'application/pdf,application/msword')
  .split(',').map((t) => t.trim());

// ─── Storage: memory (buffers sent to Cloudinary) ────────────
const memoryStorage = multer.memoryStorage();

// ─── File filter factories ────────────────────────────────────

function imageFilter(req, file, cb) {
  if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(
    new AppError(
      `Invalid image type. Allowed: ${ALLOWED_IMAGE_MIMES.join(', ')}`,
      HTTP.BAD_REQUEST,
      'INVALID_FILE_TYPE',
    ),
    false,
  );
}

function documentFilter(req, file, cb) {
  const allowed = [...ALLOWED_IMAGE_MIMES, ...ALLOWED_DOC_MIMES];
  if (allowed.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(
    new AppError(
      `Invalid file type. Allowed: ${allowed.join(', ')}`,
      HTTP.BAD_REQUEST,
      'INVALID_FILE_TYPE',
    ),
    false,
  );
}

// ─── Multer instances ─────────────────────────────────────────

const uploadImage = multer({
  storage:  memoryStorage,
  limits:   { fileSize: MAX_FILE_SIZE, files: 4 },
  fileFilter: imageFilter,
});

const uploadDocument = multer({
  storage:  memoryStorage,
  limits:   { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: documentFilter,
});

const uploadAvatar = multer({
  storage:  memoryStorage,
  limits:   { fileSize: 2 * 1024 * 1024, files: 1 }, // 2MB max for avatars
  fileFilter: imageFilter,
});

// ─── Error handler wrapper ────────────────────────────────────
// Converts multer errors into AppErrors so globalErrorHandler picks them up

function handleMulterError(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError(`File exceeds ${MAX_FILE_SIZE_MB}MB limit`, HTTP.BAD_REQUEST, 'FILE_TOO_LARGE'));
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return next(new AppError('Too many files uploaded', HTTP.BAD_REQUEST, 'TOO_MANY_FILES'));
        }
        return next(new AppError(err.message, HTTP.BAD_REQUEST, 'UPLOAD_ERROR'));
      }
      return next(err);
    });
  };
}

module.exports = {
  uploadImage:    handleMulterError(uploadImage.array('images', 4)),
  uploadSingle:   handleMulterError(uploadImage.single('image')),
  uploadDocument: handleMulterError(uploadDocument.single('file')),
  uploadAvatar:   handleMulterError(uploadAvatar.single('avatar')),
};
