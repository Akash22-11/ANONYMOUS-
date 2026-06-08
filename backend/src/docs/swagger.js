// src/docs/swagger.js — Swagger/OpenAPI 3.0 spec
// Full JSDoc annotations will be added route-by-route in subsequent phases

const swaggerJsdoc   = require('swagger-jsdoc');
const swaggerUi      = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'Mentorship Platform API',
      version:     '1.0.0',
      description: 'Anonymous college mentorship and discussion platform REST API',
      contact:     { name: 'Platform Team' },
    },
    servers: [
      { url: `http://localhost:${process.env.PORT ?? 5000}/api/${process.env.API_VERSION ?? 'v1'}`, description: 'Development' },
      { url: `https://api.yourplatform.com/api/v1`, description: 'Production' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        // Shared schemas — controllers add their own via JSDoc
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code:    { type: 'string' },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            total:       { type: 'integer' },
            page:        { type: 'integer' },
            limit:       { type: 'integer' },
            totalPages:  { type: 'integer' },
            hasNextPage: { type: 'boolean' },
            hasPrevPage: { type: 'boolean' },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = { swaggerUi, swaggerSpec };
