
# Stage 1: Dependencies — install all deps (incl. dev) for build

FROM node:20-alpine AS deps

# OpenSSL is required by Prisma's query engine on Alpine
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Stage 2: Build — generate Prisma client
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client against the schema
RUN npx prisma generate

# ──────────────────────────────────────────────────────────────
# Stage 3: Production dependencies only (smaller node_modules)
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS prod-deps

RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Re-generate Prisma client for the production node_modules
COPY prisma ./prisma
RUN npx prisma generate

# ──────────────────────────────────────────────────────────────
# Stage 4: Runtime — minimal final image
# ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl libc6-compat curl tini netcat-openbsd

# Run as non-root for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodeapp -u 1001 -G nodejs

WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000

# Copy production node_modules (with generated Prisma client)
COPY --from=prod-deps --chown=nodeapp:nodejs /app/node_modules ./node_modules
COPY --from=prod-deps --chown=nodeapp:nodejs /app/prisma       ./prisma

# Copy application source
COPY --chown=nodeapp:nodejs src ./src
COPY --chown=nodeapp:nodejs package.json ./
COPY --chown=nodeapp:nodejs scripts ./scripts

# Pre-create writable directories
RUN mkdir -p /app/logs /app/uploads && chown -R nodeapp:nodejs /app/logs /app/uploads

USER nodeapp

EXPOSE 5000

# Health check hits the /health endpoint defined in app.js
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# tini as PID 1 for proper signal forwarding (graceful shutdown)
ENTRYPOINT ["/sbin/tini", "--"]

# Run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
