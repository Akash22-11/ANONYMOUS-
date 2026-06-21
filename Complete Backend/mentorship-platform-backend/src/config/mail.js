// src/config/mail.js — Nodemailer transport + email templates

const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

let transporter = null;

function getMailTransporter() {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  return transporter;
}

async function verifyMailConfig() {
  try {
    await getMailTransporter().verify();
    logger.info('Mail transporter ready');
  } catch (err) {
    logger.error(`Mail config error: ${err.message}`);
  }
}

// ─── Generic send helper 
async function sendMail({ to, subject, html, text }) {
  const transport = getMailTransporter();
  const info = await transport.sendMail({
    from:    process.env.MAIL_FROM ?? 'Mentorship Platform <noreply@mentorship.dev>',
    to, subject, html, text,
  });
  logger.info(`Mail sent to ${to}: ${info.messageId}`);
  return info;
}


// ─── Email templates
function buildEmailTemplate(title, bodyHtml) {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f5; margin: 0; padding: 0; }
    .wrapper { max-width: 580px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .header  { background: #4f46e5; padding: 28px 32px; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; }
    .body    { padding: 32px; color: #374151; line-height: 1.6; }
    .otp     { background: #f0f0ff; border: 2px dashed #4f46e5; border-radius: 8px; padding: 18px; text-align: center; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #4f46e5; margin: 24px 0; }
    .btn     { display: inline-block; background: #4f46e5; color: #fff !important; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; margin-top: 16px; }
    .footer  { background: #f9fafb; padding: 16px 32px; color: #9ca3af; font-size: 12px; }
  </style>
  </head>
  <body>
    <div class="wrapper">
      <div class="header"><h1>🎓 Mentorship Platform</h1></div>
      <div class="body">
        <h2>${title}</h2>
        ${bodyHtml}
      </div>
      <div class="footer">You are receiving this email because you have an account on Mentorship Platform. If this wasn't you, ignore this email.</div>
    </div>
  </body>
  </html>`;
}

const EmailTemplates = {
  verifyEmail: (otp) => ({
    subject: 'Verify your email — Mentorship Platform',
    html: buildEmailTemplate('Confirm Your Email Address', `
      <p>Use the OTP below to verify your email address. It expires in <strong>10 minutes</strong>.</p>
      <div class="otp">${otp}</div>
      <p>Do not share this code with anyone.</p>
    `),
  }),

  resetPassword: (otp) => ({
    subject: 'Password Reset OTP — Mentorship Platform',
    html: buildEmailTemplate('Reset Your Password', `
      <p>You requested a password reset. Use the OTP below. It expires in <strong>10 minutes</strong>.</p>
      <div class="otp">${otp}</div>
      <p>If you did not request this, your account is safe — just ignore this email.</p>
    `),
  }),

  mentorRequestReceived: (mentorName, requesterAlias, topic) => ({
    subject: 'New mentorship request',
    html: buildEmailTemplate('You Have a New Mentorship Request', `
      <p>Hi ${mentorName},</p>
      <p><strong>${requesterAlias}</strong> has sent you a mentorship request about:</p>
      <blockquote style="border-left:4px solid #4f46e5;padding-left:16px;color:#4f46e5;">${topic}</blockquote>
      <p>Log in to review and respond.</p>
      <a class="btn" href="${process.env.FRONTEND_URL}/mentor/requests">View Request</a>
    `),
  }),

  mentorRequestAccepted: (userName, mentorAlias, scheduledAt) => ({
    subject: 'Your mentorship request was accepted! 🎉',
    html: buildEmailTemplate('Mentorship Request Accepted', `
      <p>Hi ${userName},</p>
      <p>Great news! <strong>${mentorAlias}</strong> accepted your request.</p>
      ${scheduledAt ? `<p>📅 Scheduled for: <strong>${new Date(scheduledAt).toLocaleString()}</strong></p>` : ''}
      <a class="btn" href="${process.env.FRONTEND_URL}/chat">Open Chat</a>
    `),
  }),

  welcomeEmail: (displayName, anonymousAlias) => ({
    subject: 'Welcome to Mentorship Platform! 👋',
    html: buildEmailTemplate(`Welcome, ${displayName}!`, `
      <p>You are all set. Your anonymous alias is <strong>${anonymousAlias}</strong> — this is what others see when you post anonymously.</p>
      <p>Here's what you can do next:</p>
      <ul>
        <li>Browse community posts and ask questions</li>
        <li>Connect with senior mentors for guidance</li>
        <li>Share resources to help your peers</li>
      </ul>
      <a class="btn" href="${process.env.FRONTEND_URL}">Get Started</a>
    `),
  }),
};

module.exports = { sendMail, EmailTemplates, verifyMailConfig };
