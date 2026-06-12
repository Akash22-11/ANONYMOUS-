// src/utils/cloudinaryUpload.js — Streamlined Cloudinary upload helpers

const { cloudinary, CLOUDINARY_FOLDERS, CLOUDINARY_TRANSFORMS } = require('../config/cloudinary');
const { logger } = require('./logger');

/**
 * Upload a buffer or file path to Cloudinary
 * Returns { url, publicId, width, height, format, bytes }
 */
async function uploadToCloudinary(source, { folder, transformation, resourceType = 'auto', tags = [] } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      folder:        folder ?? CLOUDINARY_FOLDERS.POST_IMAGES,
      resource_type: resourceType,
      tags,
      ...(transformation ? { transformation } : {}),
      overwrite: false,
      unique_filename: true,
    };

    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        logger.error(`Cloudinary upload failed: ${error.message}`);
        return reject(error);
      }
      resolve({
        url:       result.secure_url,
        publicId:  result.public_id,
        width:     result.width,
        height:    result.height,
        format:    result.format,
        bytes:     result.bytes,
      });
    });

    if (Buffer.isBuffer(source)) {
      uploadStream.end(source);
    } else {
      // Assume it's a readable stream
      source.pipe(uploadStream);
    }
  });
}

/**
 * Upload user avatar — applies face-crop transformation
 */
async function uploadAvatar(buffer, userId) {
  return uploadToCloudinary(buffer, {
    folder:         CLOUDINARY_FOLDERS.AVATARS,
    transformation: CLOUDINARY_TRANSFORMS.AVATAR_FULL,
    tags:           ['avatar', `user:${userId}`],
  });
}

/**
 * Upload a resource file (PDF, etc.)
 */
async function uploadResource(buffer, uploaderId) {
  return uploadToCloudinary(buffer, {
    folder:       CLOUDINARY_FOLDERS.RESOURCES,
    resourceType: 'raw',
    tags:         ['resource', `uploader:${uploaderId}`],
  });
}

/**
 * Upload a post image
 */
async function uploadPostImage(buffer, postId) {
  return uploadToCloudinary(buffer, {
    folder:         CLOUDINARY_FOLDERS.POST_IMAGES,
    transformation: CLOUDINARY_TRANSFORMS.POST_IMAGE,
    tags:           ['post-image', `post:${postId}`],
  });
}

/**
 * Delete from Cloudinary by publicId
 */
async function deleteFromCloudinary(publicId, resourceType = 'image') {
  try {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
    logger.info(`Cloudinary deleted: ${publicId} — result: ${result.result}`);
    return result;
  } catch (err) {
    logger.error(`Cloudinary delete failed for ${publicId}: ${err.message}`);
    throw err;
  }
}

/**
 * Generate an optimized URL with transformations (without re-uploading)
 */
function getOptimizedUrl(publicId, transformation = {}) {
  return cloudinary.url(publicId, {
    secure: true,
    ...transformation,
  });
}

module.exports = {
  uploadToCloudinary,
  uploadAvatar,
  uploadResource,
  uploadPostImage,
  deleteFromCloudinary,
  getOptimizedUrl,
};
