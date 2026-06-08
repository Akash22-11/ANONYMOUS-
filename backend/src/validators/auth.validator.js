// src/validators/auth.validator.js — Zod schemas for auth routes

const { z } = require('zod');

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')  // bcrypt limit
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const emailSchema = z
  .string()
  .email('Invalid email address')
  .max(254, 'Email too long')
  .toLowerCase()
  .trim();

// ── POST /auth/register ──────────────────────────────────────
const registerSchema = z.object({
  email:       emailSchema,
  password:    passwordSchema,
  displayName: z
    .string()
    .min(2,  'Display name must be at least 2 characters')
    .max(50, 'Display name must be at most 50 characters')
    .trim(),
  college:    z.string().min(2).max(100).trim().optional(),
  department: z.string().min(2).max(100).trim().optional(),
  year: z
    .enum(['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'ALUMNI'])
    .optional(),
});

// ── POST /auth/login ─────────────────────────────────────────
const loginSchema = z.object({
  email:    emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// ── POST /auth/refresh ───────────────────────────────────────
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ── POST /auth/verify-email ──────────────────────────────────
const verifyEmailSchema = z.object({
  email: emailSchema,
  otp:   z.string().length(6, 'OTP must be 6 digits').regex(/^\d+$/, 'OTP must be numeric'),
});

// ── POST /auth/resend-otp ────────────────────────────────────
const resendOtpSchema = z.object({
  email:   emailSchema,
  purpose: z.enum(['email_verify', 'password_reset', 'login_2fa']),
});

// ── POST /auth/forgot-password ───────────────────────────────
const forgotPasswordSchema = z.object({
  email: emailSchema,
});

// ── POST /auth/reset-password ────────────────────────────────
const resetPasswordSchema = z.object({
  email:       emailSchema,
  otp:         z.string().length(6).regex(/^\d+$/),
  newPassword: passwordSchema,
});

// ── POST /auth/change-password ───────────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     passwordSchema,
}).refine(
  (data) => data.currentPassword !== data.newPassword,
  { message: 'New password must differ from current password', path: ['newPassword'] },
);

module.exports = {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
};
