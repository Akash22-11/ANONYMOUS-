// src/services/auth.service.js — Auth business logic

const bcrypt = require('bcryptjs');
const { prisma }    = require('../config/db');
const { sendMail, EmailTemplates } = require('../config/mail');
const { generateTokenPair, rotateTokenPair, revokeRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { createOTP, verifyOTP, invalidateOTPs, OTP_PURPOSE } = require('../utils/otp');
const { generateUniqueAnonymousAlias, generateUniqueUsername } = require('../utils/generateUsername');
const { AppError } = require('../middleware/error');
const { HTTP }      = require('../constants/statusCodes');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);

// ─────────────────────────────────────────────────────────────
// register
// ─────────────────────────────────────────────────────────────
async function register({ email, password, displayName, college, department, year }) {
  // 1. Duplicate email check
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError('An account with this email already exists', HTTP.CONFLICT, 'EMAIL_TAKEN');
  }

  // 2. Derive unique handles
  const [passwordHash, anonymousAlias, username] = await Promise.all([
    bcrypt.hash(password, BCRYPT_ROUNDS),
    generateUniqueAnonymousAlias(),
    generateUniqueUsername(displayName),
  ]);

  // 3. Create user + profile in one transaction
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      username,
      anonymousAlias,
      role: 'STUDENT',
      profile: {
        create: {
          displayName,
          college:    college   ?? null,
          department: department ?? null,
          year:       year      ?? null,
        },
      },
    },
    select: {
      id: true, email: true, username: true, anonymousAlias: true,
      role: true, isEmailVerified: true, createdAt: true,
      profile: { select: { displayName: true } },
    },
  });

  // 4. Send verification OTP (fire-and-forget — don't block response)
  const otp = await createOTP(user.id, email, OTP_PURPOSE.EMAIL_VERIFY);
  sendMail({ to: email, ...EmailTemplates.verifyEmail(otp) }).catch(() => {});

  return user;
}

// ─────────────────────────────────────────────────────────────
// login
// ─────────────────────────────────────────────────────────────
async function login({ email, password }) {
  // 1. Load user with password hash
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true, email: true, username: true, anonymousAlias: true,
      role: true, passwordHash: true, isActive: true, isBanned: true,
      isEmailVerified: true, deletedAt: true,
    },
  });

  if (!user || user.deletedAt) {
    // Timing-safe: still run bcrypt compare to prevent user enumeration
    await bcrypt.compare(password, '$2b$12$invalidhashtopreventtimingattack');
    throw new AppError('Invalid email or password', HTTP.UNAUTHORIZED, 'INVALID_CREDENTIALS');
  }

  if (user.isBanned) {
    throw new AppError('Your account has been banned. Contact support.', HTTP.FORBIDDEN, 'ACCOUNT_BANNED');
  }
  if (!user.isActive) {
    throw new AppError('Your account is inactive. Contact support.', HTTP.FORBIDDEN, 'ACCOUNT_INACTIVE');
  }

  // 2. Verify password
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new AppError('Invalid email or password', HTTP.UNAUTHORIZED, 'INVALID_CREDENTIALS');
  }

  // 3. Issue tokens + update lastLoginAt
  const [tokens] = await Promise.all([
    generateTokenPair(user),
    prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    }),
  ]);

  // Strip sensitive fields before returning
  const { passwordHash: _, ...safeUser } = user;
  return { user: safeUser, ...tokens };
}

// ─────────────────────────────────────────────────────────────
// logout
// ─────────────────────────────────────────────────────────────
async function logout(userId) {
  await revokeRefreshToken(userId);
}

// ─────────────────────────────────────────────────────────────
// refreshTokens
// ─────────────────────────────────────────────────────────────
async function refreshTokens(incomingRefreshToken) {
  // 1. Verify signature + expiry
  let decoded;
  try {
    decoded = verifyRefreshToken(incomingRefreshToken);
  } catch {
    throw new AppError('Invalid or expired refresh token', HTTP.UNAUTHORIZED, 'INVALID_REFRESH_TOKEN');
  }

  // 2. Load fresh user data
  const user = await prisma.user.findUnique({
    where:  { id: decoded.sub },
    select: { id: true, email: true, username: true, anonymousAlias: true, role: true, isActive: true, isBanned: true, deletedAt: true },
  });

  if (!user || user.deletedAt || !user.isActive || user.isBanned) {
    throw new AppError('User account unavailable', HTTP.UNAUTHORIZED, 'ACCOUNT_UNAVAILABLE');
  }

  // 3. Rotate — invalidates old token, issues new pair
  const tokens = await rotateTokenPair(user, incomingRefreshToken);
  return { user, ...tokens };
}

// ─────────────────────────────────────────────────────────────
// verifyEmail
// ─────────────────────────────────────────────────────────────
async function verifyEmail({ email, otp }) {
  const user = await prisma.user.findUnique({
    where:  { email },
    select: { id: true, isEmailVerified: true },
  });

  if (!user) {
    throw new AppError('User not found', HTTP.NOT_FOUND, 'USER_NOT_FOUND');
  }
  if (user.isEmailVerified) {
    throw new AppError('Email is already verified', HTTP.CONFLICT, 'ALREADY_VERIFIED');
  }

  // Throws if invalid/expired
  await verifyOTP(user.id, OTP_PURPOSE.EMAIL_VERIFY, otp);

  // Mark verified
  await prisma.user.update({
    where: { id: user.id },
    data:  { isEmailVerified: true },
  });

  // Send welcome email fire-and-forget
  const fullUser = await prisma.user.findUnique({
    where:  { id: user.id },
    select: { email: true, anonymousAlias: true, profile: { select: { displayName: true } } },
  });
  sendMail({
    to: fullUser.email,
    ...EmailTemplates.welcomeEmail(fullUser.profile?.displayName ?? 'there', fullUser.anonymousAlias),
  }).catch(() => {});

  return { verified: true };
}

// ─────────────────────────────────────────────────────────────
// resendOtp
// ─────────────────────────────────────────────────────────────
async function resendOtp({ email, purpose }) {
  const user = await prisma.user.findUnique({
    where:  { email },
    select: { id: true, isEmailVerified: true },
  });

  if (!user) {
    // Return success anyway — don't reveal whether email exists
    return { sent: true };
  }

  if (purpose === OTP_PURPOSE.EMAIL_VERIFY && user.isEmailVerified) {
    throw new AppError('Email is already verified', HTTP.CONFLICT, 'ALREADY_VERIFIED');
  }

  const otp = await createOTP(user.id, email, purpose);

  const template =
    purpose === OTP_PURPOSE.PASSWORD_RESET
      ? EmailTemplates.resetPassword(otp)
      : EmailTemplates.verifyEmail(otp);

  sendMail({ to: email, ...template }).catch(() => {});

  return { sent: true };
}

// ─────────────────────────────────────────────────────────────
// forgotPassword
// ─────────────────────────────────────────────────────────────
async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({
    where:  { email },
    select: { id: true },
  });

  // Always return success — never reveal whether email exists
  if (!user) return { sent: true };

  const otp = await createOTP(user.id, email, OTP_PURPOSE.PASSWORD_RESET);
  sendMail({ to: email, ...EmailTemplates.resetPassword(otp) }).catch(() => {});

  return { sent: true };
}

// ─────────────────────────────────────────────────────────────
// resetPassword
// ─────────────────────────────────────────────────────────────
async function resetPassword({ email, otp, newPassword }) {
  const user = await prisma.user.findUnique({
    where:  { email },
    select: { id: true },
  });

  if (!user) {
    throw new AppError('Invalid OTP or email', HTTP.BAD_REQUEST, 'INVALID_OTP');
  }

  // Verify OTP first — throws on failure
  await verifyOTP(user.id, OTP_PURPOSE.PASSWORD_RESET, otp);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Update password + revoke all refresh tokens (force re-login everywhere)
  await Promise.all([
    prisma.user.update({
      where: { id: user.id },
      data:  { passwordHash, refreshToken: null },
    }),
    revokeRefreshToken(user.id),
    invalidateOTPs(user.id, OTP_PURPOSE.PASSWORD_RESET),
  ]);

  return { reset: true };
}

// ─────────────────────────────────────────────────────────────
// changePassword (authenticated)
// ─────────────────────────────────────────────────────────────
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new AppError('User not found', HTTP.NOT_FOUND);
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    throw new AppError('Current password is incorrect', HTTP.BAD_REQUEST, 'WRONG_PASSWORD');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  await Promise.all([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    revokeRefreshToken(userId), // force re-login on other devices
  ]);

  return { changed: true };
}

module.exports = {
  register,
  login,
  logout,
  refreshTokens,
  verifyEmail,
  resendOtp,
  forgotPassword,
  resetPassword,
  changePassword,
};
