// src/config/cloudinary.js — Cloudinary v2 configuration

const cloudinary = require('cloudinary').v2;
const { logger } = require('../utils/logger');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});


// Verify config on startup
async function verifyCloudinaryConfig() {
  try {
    await cloudinary.api.ping();
    logger.info('Cloudinary connected');
  } catch (err) {
    logger.error(`Cloudinary config error: ${err.message}`);
  
    // Non-fatal — uploads will fail gracefully at request time
  }
}


// ─── Upload preset constants 
const CLOUDINARY_FOLDERS = Object.freeze({
  AVATARS:    'mentorship/avatars',
  POST_IMAGES: 'mentorship/posts',
  RESOURCES:  'mentorship/resources',
  CHAT_MEDIA: 'mentorship/chat',
});

const CLOUDINARY_TRANSFORMS = Object.freeze({
  AVATAR_THUMB: { width: 150, height: 150, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' },
  AVATAR_FULL:  { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto', fetch_format: 'auto' },
  POST_IMAGE:   { width: 1200, quality: 'auto:good', fetch_format: 'auto' },
});

module.exports = { cloudinary, verifyCloudinaryConfig, CLOUDINARY_FOLDERS, CLOUDINARY_TRANSFORMS };
