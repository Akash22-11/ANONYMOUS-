# 🎓 Anonymous College Mentorship Platform — Backend

A production-grade Node.js/Express backend for an anonymous college mentorship
and discussion platform — juniors get anonymous access to seniors for
mentorship, coding guidance, placement prep, and resource sharing.

---

## Tech Stack

| Layer          | Technology |
|----------------|------------|
| Runtime        | Node.js 20, Express 4 |
| Database       | PostgreSQL 16 + Prisma ORM 5 |
| Cache / Queues | Redis 7 (ioredis + Upstash REST) |
| Real-time      | Socket.IO 4 |
| Auth           | JWT (access + refresh rotation), bcrypt |
| File storage   | Cloudinary |
| Validation     | Zod |
| Logging        | Winston (daily rotating files) |
| Docs           | Swagger / OpenAPI 3.0 |

---

## Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma      # 22 models, full relational schema
│   └── seed.js            # Dev seed data
├── src/
│   ├── config/            # db, redis, cloudinary, mail, socket
│   ├── constants/          # roles, status codes, tags
│   ├── middleware/         # auth, admin, error, rateLimit, upload, validation, toxicity, logger
│   ├── validators/         # Zod schemas per module
│   ├── services/           # Business logic (DB access via Prisma)
│   ├── controllers/        # HTTP request/response handling
│   ├── routes/             # Express routers
│   ├── sockets/            # Socket.IO event handlers
│   ├── utils/              # jwt, otp, logger, pagination, etc.
│   ├── docs/swagger.js     # OpenAPI spec
│   ├── app.js              # Express app factory
│   └── server.js           # HTTP + Socket.IO bootstrap, graceful shutdown
├── scripts/                 # healthcheck.js, wait-for-it.sh
├── Dockerfile               # Multi-stage production build
├── docker-compose.yml        # Postgres, Redis, app, dev tools
└── .env.example
```

---

## Quick Start (Local Development)

### 1. Prerequisites
- Node.js ≥ 18
- Docker & Docker Compose (for Postgres/Redis)

### 2. Clone & install
```bash
npm install
cp .env.example .env
```

### 3. Edit `.env`
At minimum, set:
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
- `CLOUDINARY_*` — from your Cloudinary dashboard
- `SMTP_*` — for OTP/email delivery (Gmail App Password works for dev)

### 4. Start Postgres + Redis
```bash
docker compose up -d postgres redis
```

### 5. Run migrations & seed data
```bash
npx prisma migrate dev
npm run prisma:seed
```

### 6. Start the dev server
```bash
npm run dev
```

The API is now live at `http://localhost:5000/api/v1`
Swagger docs: `http://localhost:5000/api-docs`
Health check: `http://localhost:5000/health`

### Seeded test accounts
| Role    | Email | Password |
|---------|-------|----------|
| Admin   | admin@mentorship.dev | Admin@123456 |
| Mentor  | senior.ananya@mentorship.dev | Mentor@123456 |
| Student | stu.kavya@mentorship.dev | Student@123456 |

---

## Running with Docker (Full Stack)

```bash
# Build and run app + postgres + redis together
docker compose --profile production up -d --build

# View logs
docker compose logs -f app

# Run migrations inside the container (if not auto-run by CMD)
docker compose exec app npx prisma migrate deploy
```

Dev tools (pgAdmin on :5050, Redis Commander on :8081):
```bash
docker compose --profile dev up -d
```

---

## API Overview

All endpoints are prefixed with `/api/v1`. Full interactive docs at `/api-docs`.

| Group | Base path | Highlights |
|---|---|---|
| Auth | `/auth` | register, login, OTP verify, refresh rotation, password reset |
| Users | `/users` | profiles, avatars, mentor profile setup, follow system |
| Posts | `/posts` | CRUD, trending algorithm, tags, mark-solved |
| Comments | `/comments` | threaded replies (max depth 3), edit/delete |
| Votes | `/comments/votes` | idempotent upvote/downvote toggle |
| Reports | `/reports` | submit + admin resolution queue |
| Mentors | `/mentors` | directory, booking requests, accept/decline, feedback |
| Chat | `/chats` | DMs, mentor chat rooms, message history, edit/delete |
| Notifications | `/notifications` | feed, unread count, mark read |
| Resources | `/resources` | file/link uploads, approval queue, download tracking |
| Admin | `/admin` | analytics dashboard, user bans, moderation, audit log |

### Authentication flow
1. `POST /auth/register` → account created, OTP emailed
2. `POST /auth/verify-email` → email verified
3. `POST /auth/login` → returns `accessToken` (body) + `refreshToken` (httpOnly cookie)
4. Use `Authorization: Bearer <accessToken>` on subsequent requests
5. `POST /auth/refresh` → rotates both tokens when access token expires

---

## Real-time (Socket.IO)

Connect with:
```js
const socket = io('http://localhost:5000', {
  auth: { token: '<accessToken>' }
});
```

| Event (client → server) | Payload |
|---|---|
| `chat:join` | `{ chatId }` |
| `chat:message:send` | `{ chatId, body, replyToId?, mediaUrl? }` |
| `chat:typing:start` / `chat:typing:stop` | `{ chatId }` |
| `chat:message:seen` | `{ chatId, messageId }` |

| Event (server → client) | Payload |
|---|---|
| `chat:message:new` | Message object |
| `notification:new` | Notification object |
| `users:online` / `user:online` / `user:offline` | Presence updates |

---

## Background Jobs (Recommended Cron Setup)

These are not auto-scheduled — wire them up with your platform's scheduler
(e.g., a separate worker dyno, `node-cron`, or external cron hitting an admin endpoint):

- **View count flush** — `postService.flushViewCounts()` batches Redis view
  counters into Postgres. Recommended: every 5 minutes.
- **Trending score recompute** — recalculates `Post.trendingScore` for active
  posts. Recommended: every 15 minutes.
- **OTP cleanup** — purge expired `OTPVerification` rows. Recommended: daily.

---

## Environment Variables

See `.env.example` for the full annotated list. Key groups:
- **Server**: `PORT`, `NODE_ENV`, `FRONTEND_URL`
- **Database**: `DATABASE_URL`
- **Redis**: `REDIS_URL`, `UPSTASH_REDIS_REST_URL` / `_TOKEN` (prod rate limiting)
- **JWT**: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, expiry windows
- **Cloudinary**: `CLOUDINARY_CLOUD_NAME`, `_API_KEY`, `_API_SECRET`
- **SMTP**: `SMTP_HOST`, `_PORT`, `_USER`, `_PASS`, `MAIL_FROM`
- **Feature flags**: `ENABLE_SWAGGER`, `ENABLE_TOXICITY_FILTER`, `REQUIRE_EMAIL_VERIFICATION`

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm start` | Production start (no reload) |
| `npm run prisma:migrate:dev` | Create + apply a new migration |
| `npm run prisma:migrate` | Apply migrations (production) |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:seed` | Populate dev data |
| `npm run lint` / `lint:fix` | ESLint |
| `npm test` | Jest test suite |

---

## Security Notes

- Refresh tokens are stored in Redis and rotated on every refresh; reuse of a
  stale token revokes the entire session (theft mitigation).
- Passwords hashed with bcrypt (12 rounds).
- All mutating endpoints pass through Zod validation before reaching services.
- Toxicity filter scans post/comment/resource text; flagged content auto-creates
  a moderation report without blocking the user.
- Banned users have their refresh token revoked immediately — they're logged
  out on their next request.
- Admin role changes require `SUPER_ADMIN`.

---

## License

MIT
