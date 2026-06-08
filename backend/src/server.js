// src/server.js — HTTP server bootstrap + graceful shutdown

'use strict';
require('dotenv').config();

const http = require('http');
const { createApp }      = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const { getRedisClient, disconnectRedis } = require('./config/redis');
const { verifyCloudinaryConfig } = require('./config/cloudinary');
const { verifyMailConfig }       = require('./config/mail');
const { initSocket }             = require('./config/socket');
const { logger }                 = require('./utils/logger');

// Will be registered in Phase 5 (real-time)
// const { registerChatHandlers }         = require('./sockets/chat');
// const { registerNotificationHandlers } = require('./sockets/notification');
// const { registerOnlineUserHandlers }   = require('./sockets/onlineUsers');

const PORT = parseInt(process.env.PORT ?? '5000', 10);

async function bootstrap() {
  // ── 1. Connect to external services ─────────────────────
  logger.info('Bootstrapping server...');

  await connectDB();

  // Warm up Redis connection
  const redis = getRedisClient();
  await redis.ping();
  logger.info('Redis: ping OK');

  // Non-fatal service checks
  await verifyCloudinaryConfig();
  await verifyMailConfig();

  // ── 2. Create Express app ────────────────────────────────
  const app = createApp();

  // ── 3. Create HTTP server + attach Socket.IO ─────────────
  const httpServer = http.createServer(app);
  const io = initSocket(httpServer);

  // ── 4. Register socket handlers (Phase 5) ────────────────
  // registerChatHandlers(io);
  // registerNotificationHandlers(io);
  // registerOnlineUserHandlers(io);

  // ── 5. Start listening ───────────────────────────────────
  await new Promise((resolve, reject) => {
    httpServer.listen(PORT, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

  logger.info(`Server running on port ${PORT} [${process.env.NODE_ENV}]`);
  logger.info(`API base: http://localhost:${PORT}/api/${process.env.API_VERSION ?? 'v1'}`);
  if (process.env.ENABLE_SWAGGER === 'true') {
    logger.info(`Swagger UI: http://localhost:${PORT}/api-docs`);
  }

  return httpServer;
}

// ── Graceful shutdown ────────────────────────────────────────

async function shutdown(signal, server) {
  logger.info(`${signal} received — initiating graceful shutdown`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await disconnectDB();
      await disconnectRedis();
    } catch (err) {
      logger.error(`Error during shutdown cleanup: ${err.message}`);
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit after 15s if shutdown hangs
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000);
}

// ── Unhandled rejection / exception guards ───────────────────

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection: ${reason}`);
  process.exit(1);
});

// ── Start ────────────────────────────────────────────────────

bootstrap()
  .then((server) => {
    process.on('SIGTERM', () => shutdown('SIGTERM', server));
    process.on('SIGINT',  () => shutdown('SIGINT',  server));
  })
  .catch((err) => {
    logger.error(`Bootstrap failed: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
