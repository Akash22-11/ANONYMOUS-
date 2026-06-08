// src/app.js — Express application factory

'use strict';
require('dotenv').config();
require('express-async-errors');

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const { httpLogger }       = require('./middleware/logger');
const { globalErrorHandler, notFoundHandler } = require('./middleware/error');
const { RateLimiters }     = require('./middleware/rateLimit');
const { HTTP }             = require('./constants/statusCodes');

// ─── App factory ─────────────────────────────────────────────

function createApp() {
  const app = express();

  // ── Security headers ───────────────────────────────────────
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  }));

  // ── CORS ───────────────────────────────────────────────────
  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:3000')
    .split(',').map((o) => o.trim());

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials:     true,
    methods:         ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders:  ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders:  ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  }));

  // ── Body parsers ───────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // ── Compression ────────────────────────────────────────────
  app.use(compression());

  // ── Request logging ────────────────────────────────────────
  app.use(httpLogger);

  // ── Trust proxy (for accurate IP behind nginx/load balancer)
  app.set('trust proxy', 1);

  // ── Global rate limit ──────────────────────────────────────
  app.use('/api', RateLimiters.api);

  // ── Health check ───────────────────────────────────────────
  app.get('/health', (req, res) => {
    res.status(HTTP.OK).json({
      success: true,
      status:  'healthy',
      env:     process.env.NODE_ENV,
      ts:      new Date().toISOString(),
    });
  });

  // ── API version prefix ─────────────────────────────────────
  const apiVersion = process.env.API_VERSION ?? 'v1';
  const apiRouter  = express.Router();

  // ── Phase 3: Auth & Users ──────────────────────────────────
  apiRouter.use('/auth',  require('./routes/auth.routes'));
  apiRouter.use('/users', require('./routes/user.routes'));

  // ── Phase 4: Social — Posts, Comments, Votes, Reports ──────
  apiRouter.use('/posts',    require('./routes/post.routes'));
  apiRouter.use('/comments', require('./routes/comment.routes'));
  apiRouter.use('/reports',  require('./routes/report.routes'));

  // ── Phase 5+ (uncommented as modules are built) ────────────
  // apiRouter.use('/mentors',       require('./routes/mentor.routes'));
  // apiRouter.use('/chats',         require('./routes/chat.routes'));
  // apiRouter.use('/resources',     require('./routes/resource.routes'));
  // apiRouter.use('/notifications', require('./routes/notification.routes'));
  // apiRouter.use('/admin',         require('./routes/admin.routes'));

  // ── Swagger docs ───────────────────────────────────────────
  if (process.env.ENABLE_SWAGGER === 'true') {
    const { swaggerUi, swaggerSpec } = require('./docs/swagger');
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
      explorer:     true,
      swaggerOptions: { persistAuthorization: true },
    }));
  }

  app.use(`/api/${apiVersion}`, apiRouter);

  // ── 404 handler ────────────────────────────────────────────
  app.use(notFoundHandler);

  // ── Global error handler (must be last) ───────────────────
  app.use(globalErrorHandler);

  return app;
}

module.exports = { createApp };
