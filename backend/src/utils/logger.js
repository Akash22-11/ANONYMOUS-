// src/utils/logger.js — Winston logger with daily rotating files

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR  = path.resolve(process.env.LOG_DIR ?? 'logs');
const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

// ─── Custom format ────────────────────────────────────────────
const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ timestamp, level, message, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} [${level}]: ${stack ?? message}${metaStr}`;
  }),
);

const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

// ─── Transports ───────────────────────────────────────────────
const transports = [];

// Console — always on
transports.push(
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
);

// File transports — production + development
if (process.env.NODE_ENV !== 'test') {
  transports.push(
    new DailyRotateFile({
      filename:    path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level:       'error',
      maxSize:     '20m',
      maxFiles:    '14d',
      format:      prodFormat,
    }),
    new DailyRotateFile({
      filename:    path.join(LOG_DIR, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize:     '20m',
      maxFiles:    '7d',
      format:      prodFormat,
    }),
  );
}

const logger = winston.createLogger({
  level:      LOG_LEVEL,
  transports,
  exitOnError: false,
});

// ─── HTTP request logger stream (for Morgan-style logging) ───
const httpLogStream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = { logger, httpLogStream };
