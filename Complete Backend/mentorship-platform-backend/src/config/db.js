// src/config/db.js — Prisma client singleton

const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const globalForPrisma = globalThis;

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

// Log slow queries in development
if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 200) {
      logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
    }
  });
}

prisma.$on('error', (e) => {
  logger.error('Prisma error:', e);
});

// Prevent multiple instances during hot-reload in dev
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Connect to the database with retry logic
 */
async function connectDB() {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await prisma.$connect();
      logger.info('PostgreSQL connected via Prisma');
      return;
    } catch (err) {
      attempt++;
      logger.error(`DB connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt)); // exponential back-off
    }
  }
}

/**
 * Graceful disconnect
 */
async function disconnectDB() {
  await prisma.$disconnect();
  logger.info('PostgreSQL disconnected');
}

module.exports = { prisma, connectDB, disconnectDB };
