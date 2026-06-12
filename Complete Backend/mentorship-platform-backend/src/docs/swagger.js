// src/docs/swagger.js — Swagger/OpenAPI 3.0 spec
// Reusable component schemas + route JSDoc auto-discovery

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi    = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Mentorship Platform API',
      version:     '1.0.0',
      description: `
REST API for the Anonymous College Mentorship & Discussion Platform.

## Authentication
Most endpoints require a Bearer access token obtained via \`POST /auth/login\`.
Refresh tokens are delivered as httpOnly cookies and rotated via \`POST /auth/refresh\`.

## Anonymous Identity
Every user has both a real \`username\` and an \`anonymousAlias\` (e.g. "CrypticOwl#4821").
When \`isAnonymous: true\` is set on posts, comments, or resources, only the alias is exposed.

## Rate Limiting
Sensitive endpoints (login, register, OTP, post/comment creation, chat messages)
are rate-limited. Check the \`X-RateLimit-*\` response headers.

## Real-time
Socket.IO is available at the same host. Authenticate the socket handshake with
\`{ auth: { token: '<accessToken>' } }\`. See /sockets for event names.
      `.trim(),
      contact: { name: 'Platform Team' },
      license: { name: 'MIT' },
    },
    servers: [
      { url: `http://localhost:${process.env.PORT ?? 5000}/api/${process.env.API_VERSION ?? 'v1'}`, description: 'Development' },
      { url: 'https://api.yourplatform.com/api/v1', description: 'Production' },
    ],
    tags: [
      { name: 'Auth',          description: 'Registration, login, tokens, password management' },
      { name: 'Users',         description: 'Profiles, follows, mentor profile setup' },
      { name: 'Posts',         description: 'Community questions and discussions' },
      { name: 'Comments',      description: 'Threaded replies on posts' },
      { name: 'Votes',         description: 'Upvote/downvote posts and comments' },
      { name: 'Reports',       description: 'Content moderation reporting' },
      { name: 'Mentors',       description: 'Mentor directory and session booking' },
      { name: 'Chat',          description: 'Real-time messaging' },
      { name: 'Notifications', description: 'In-app notification feed' },
      { name: 'Resources',     description: 'Shared files, notes, and links' },
      { name: 'Admin',         description: 'Moderation, analytics, and platform management' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'Access token from /auth/login or /auth/refresh',
        },
      },
      schemas: {
        // ── Shared envelopes ────────────────────────────────
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Validation failed' },
            code:    { type: 'string', example: 'VALIDATION_ERROR', nullable: true },
            errors:  {
              type: 'array', nullable: true,
              items: {
                type: 'object',
                properties: {
                  field:   { type: 'string', example: 'email' },
                  message: { type: 'string', example: 'Invalid email address' },
                },
              },
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data:    { type: 'object', nullable: true },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            total:       { type: 'integer', example: 145 },
            page:        { type: 'integer', example: 1 },
            limit:       { type: 'integer', example: 20 },
            totalPages:  { type: 'integer', example: 8 },
            hasNextPage: { type: 'boolean' },
            hasPrevPage: { type: 'boolean' },
            nextCursor:  { type: 'string', nullable: true },
          },
        },

        // ── Domain entities ─────────────────────────────────
        User: {
          type: 'object',
          properties: {
            id:              { type: 'string', format: 'uuid' },
            username:        { type: 'string', example: 'ananya_senior' },
            anonymousAlias:  { type: 'string', example: 'CrypticOwl#0042' },
            role:            { type: 'string', enum: ['STUDENT', 'MENTOR', 'ADMIN', 'SUPER_ADMIN'] },
            isEmailVerified: { type: 'boolean' },
            createdAt:       { type: 'string', format: 'date-time' },
          },
        },
        Profile: {
          type: 'object',
          properties: {
            displayName:      { type: 'string', nullable: true },
            bio:              { type: 'string', nullable: true },
            avatarUrl:        { type: 'string', nullable: true },
            college:          { type: 'string', nullable: true },
            department:       { type: 'string', nullable: true },
            year:             { type: 'string', enum: ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'ALUMNI'], nullable: true },
            skills:           { type: 'array', items: { type: 'string' } },
            reputationPoints: { type: 'integer', example: 240 },
          },
        },
        Post: {
          type: 'object',
          properties: {
            id:            { type: 'string', format: 'uuid' },
            title:         { type: 'string' },
            body:          { type: 'string' },
            slug:          { type: 'string', example: 'how-to-crack-faang-7-cgpa-a1b2c3' },
            isAnonymous:   { type: 'boolean' },
            status:        { type: 'string', enum: ['ACTIVE', 'ARCHIVED', 'REMOVED', 'PENDING_REVIEW'] },
            isPinned:      { type: 'boolean' },
            isSolved:      { type: 'boolean' },
            upvoteCount:   { type: 'integer' },
            downvoteCount: { type: 'integer' },
            commentCount:  { type: 'integer' },
            viewCount:     { type: 'integer' },
            trendingScore: { type: 'number', format: 'float' },
            imageUrls:     { type: 'array', items: { type: 'string' } },
            tags:          { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
            author:        { $ref: '#/components/schemas/User' },
            createdAt:     { type: 'string', format: 'date-time' },
          },
        },
        Comment: {
          type: 'object',
          properties: {
            id:            { type: 'string', format: 'uuid' },
            postId:        { type: 'string', format: 'uuid' },
            parentId:      { type: 'string', format: 'uuid', nullable: true },
            body:          { type: 'string' },
            isAnonymous:   { type: 'boolean' },
            isBestAnswer:  { type: 'boolean' },
            upvoteCount:   { type: 'integer' },
            downvoteCount: { type: 'integer' },
            depth:         { type: 'integer', maximum: 3 },
            replies:       { type: 'array', items: { type: 'object' } },
            createdAt:     { type: 'string', format: 'date-time' },
          },
        },
        Tag: {
          type: 'object',
          properties: {
            id:    { type: 'string', format: 'uuid' },
            name:  { type: 'string', example: 'DSA' },
            slug:  { type: 'string', example: 'dsa' },
            color: { type: 'string', example: '#4f46e5' },
          },
        },
        Vote: {
          type: 'object',
          properties: {
            action:        { type: 'string', enum: ['created', 'removed', 'switched'] },
            voteType:      { type: 'string', enum: ['UPVOTE', 'DOWNVOTE'], nullable: true },
            upvoteCount:   { type: 'integer' },
            downvoteCount: { type: 'integer' },
          },
        },
        Report: {
          type: 'object',
          properties: {
            id:          { type: 'string', format: 'uuid' },
            reason:      { type: 'string', enum: ['SPAM', 'HARASSMENT', 'OFFENSIVE_CONTENT', 'MISINFORMATION', 'PLAGIARISM', 'INAPPROPRIATE', 'OTHER'] },
            description: { type: 'string', nullable: true },
            status:      { type: 'string', enum: ['PENDING', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED'] },
            createdAt:   { type: 'string', format: 'date-time' },
          },
        },
        MentorProfile: {
          type: 'object',
          properties: {
            id:                  { type: 'string', format: 'uuid' },
            headline:            { type: 'string', nullable: true, example: 'SDE-2 @ Google | IIT Delhi CSE 2022' },
            expertise:           { type: 'array', items: { type: 'string' } },
            currentCompany:      { type: 'string', nullable: true },
            yearsOfExperience:   { type: 'integer', nullable: true },
            isAvailable:         { type: 'boolean' },
            maxWeeklySessions:   { type: 'integer' },
            sessionTopics:       { type: 'array', items: { type: 'string' } },
            totalSessions:       { type: 'integer' },
            avgRating:           { type: 'number', format: 'float', example: 4.6 },
            verifiedMentor:      { type: 'boolean' },
            user:                { $ref: '#/components/schemas/User' },
          },
        },
        MentorRequest: {
          type: 'object',
          properties: {
            id:            { type: 'string', format: 'uuid' },
            topic:         { type: 'string' },
            description:   { type: 'string' },
            status:        { type: 'string', enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'COMPLETED'] },
            scheduledAt:   { type: 'string', format: 'date-time', nullable: true },
            isAnonymous:   { type: 'boolean' },
            chatRoomId:    { type: 'string', format: 'uuid', nullable: true },
            createdAt:     { type: 'string', format: 'date-time' },
          },
        },
        Chat: {
          type: 'object',
          properties: {
            id:           { type: 'string', format: 'uuid' },
            isGroup:      { type: 'boolean' },
            participants: { type: 'array', items: { type: 'object' } },
            lastMessage:  { $ref: '#/components/schemas/Message' },
            updatedAt:    { type: 'string', format: 'date-time' },
          },
        },
        Message: {
          type: 'object',
          properties: {
            id:        { type: 'string', format: 'uuid' },
            chatId:    { type: 'string', format: 'uuid' },
            body:      { type: 'string', nullable: true },
            mediaUrl:  { type: 'string', nullable: true },
            status:    { type: 'string', enum: ['SENT', 'DELIVERED', 'READ'] },
            isEdited:  { type: 'boolean' },
            isDeleted: { type: 'boolean' },
            sender:    { $ref: '#/components/schemas/User' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            type:       {
              type: 'string',
              enum: ['MENTION', 'REPLY', 'UPVOTE', 'COMMENT', 'MENTOR_REQUEST', 'MENTOR_ACCEPTED',
                     'MENTOR_DECLINED', 'SESSION_REMINDER', 'SESSION_STARTED', 'NEW_FOLLOWER',
                     'RESOURCE_SHARED', 'REPORT_RESOLVED', 'SYSTEM', 'BADGE_EARNED'],
            },
            title:      { type: 'string' },
            body:       { type: 'string' },
            isRead:     { type: 'boolean' },
            entityType: { type: 'string', nullable: true },
            entityId:   { type: 'string', nullable: true },
            createdAt:  { type: 'string', format: 'date-time' },
          },
        },
        Resource: {
          type: 'object',
          properties: {
            id:            { type: 'string', format: 'uuid' },
            title:         { type: 'string' },
            description:   { type: 'string', nullable: true },
            type:          { type: 'string', enum: ['PDF', 'NOTE', 'RESUME_TEMPLATE', 'ROADMAP', 'CHEATSHEET', 'LINK', 'VIDEO', 'OTHER'] },
            fileUrl:       { type: 'string', nullable: true },
            externalUrl:   { type: 'string', nullable: true },
            isApproved:    { type: 'boolean' },
            downloadCount: { type: 'integer' },
            viewCount:     { type: 'integer' },
            tags:          { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
            createdAt:     { type: 'string', format: 'date-time' },
          },
        },
        AnalyticsOverview: {
          type: 'object',
          properties: {
            period: { type: 'string', enum: ['7d', '30d', '90d', 'all'] },
            overview: {
              type: 'object',
              properties: {
                users:          { type: 'object', properties: { total: { type: 'integer' }, new: { type: 'integer' } } },
                posts:          { type: 'object', properties: { total: { type: 'integer' }, new: { type: 'integer' } } },
                reports:        { type: 'object', properties: { total: { type: 'integer' }, pending: { type: 'integer' } } },
                bannedUsers:    { type: 'integer' },
              },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid access token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Insufficient permissions for this action',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Resource not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        ValidationError: {
          description: 'Request body failed validation',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        RateLimited: {
          description: 'Too many requests',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerUi, swaggerSpec };
