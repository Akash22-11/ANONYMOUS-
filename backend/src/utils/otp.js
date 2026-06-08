// src/utils/otp.js — OTP generation, hashing, and verification

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getRedisClient, RedisKeys, TTL } = require('../config/redis');
const { prisma } = require('../config/db');

const OTP_LENGTH    = parseInt(process.env.OTP_LENGTH ?? '6', 10);
const OTP_EXPIRY    = parseInt(process.env.OTP_EXPIRY_MINUTES ?? '10', 10) * 60; // seconds
const MAX_ATTEMPTS  = parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10);

// ─── OTP purposes ────────────────────────────────────────────
const OTP_PURPOSE = Object.freeze({
  EMAIL_VERIFY:   'email_verify',
  PASSWORD_RESET: 'password_reset',
  LOGIN_2FA:      'login_2fa',
});

/**
 * Generate a cryptographically random numeric OTP
 */
function generateOTPCode() {
  const max = Math.pow(10, OTP_LENGTH);
  const min = Math.pow(10, OTP_LENGTH - 1);
  return String(crypto.randomInt(min, max));
}

/**
 * Create OTP — hash it, store in DB, return plain OTP for email
 */
async function createOTP(userId, email, purpose) {
  const plain = generateOTPCode();
  const hashed = await bcrypt.hash(plain, 10);

  const expiresAt = new Date(Date.now() + OTP_EXPIRY * 1000);

  // Invalidate any existing unused OTP for same user+purpose
  await prisma.oTPVerification.updateMany({
    where: { userId, purpose, isUsed: false },
    data:  { isUsed: true },
  });

  await prisma.oTPVerification.create({
    data: { userId, email, code: hashed, purpose, expiresAt },
  });

  return plain; // caller sends this via email
}

/**
 * Verify an OTP code
 * Returns { valid: true } or throws an AppError
 */
async function verifyOTP(userId, purpose, plainCode) {
  const record = await prisma.oTPVerification.findFirst({
    where: {
      userId,
      purpose,
      isUsed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    throw Object.assign(new Error('OTP not found or expired'), { statusCode: 400, code: 'OTP_INVALID' });
  }

  // Increment attempt counter
  await prisma.oTPVerification.update({
    where: { id: record.id },
    data:  { attempts: { increment: 1 } },
  });

  if (record.attempts + 1 >= MAX_ATTEMPTS) {
    await prisma.oTPVerification.update({
      where: { id: record.id },
      data:  { isUsed: true },
    });
    throw Object.assign(new Error('Too many incorrect attempts. Request a new OTP.'), { statusCode: 429, code: 'OTP_MAX_ATTEMPTS' });
  }

  const isMatch = await bcrypt.compare(plainCode, record.code);
  if (!isMatch) {
    throw Object.assign(new Error('Invalid OTP code'), { statusCode: 400, code: 'OTP_INVALID' });
  }

  // Mark as used
  await prisma.oTPVerification.update({
    where: { id: record.id },
    data:  { isUsed: true },
  });

  return { valid: true };
}

/**
 * Invalidate all OTPs for a user+purpose (e.g., on password change)
 */
async function invalidateOTPs(userId, purpose) {
  await prisma.oTPVerification.updateMany({
    where: { userId, purpose, isUsed: false },
    data:  { isUsed: true },
  });
}

module.exports = { createOTP, verifyOTP, invalidateOTPs, OTP_PURPOSE, generateOTPCode };
