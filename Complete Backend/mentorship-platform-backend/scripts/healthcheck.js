#!/usr/bin/env node
const http = require('http');

const PORT = process.env.PORT || 5000;
const HOST = process.env.HEALTHCHECK_HOST || 'localhost';
const PATH = process.env.HEALTHCHECK_PATH || '/health';
const TIMEOUT_MS = Number(process.env.HEALTHCHECK_TIMEOUT_MS) || 3000;

const url = `http://${HOST}:${PORT}${PATH}`;

const req = http.get(url, { timeout: TIMEOUT_MS }, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('Healthy:', data);
      process.exit(0);
    } else {
      console.error(`Unhealthy — ${url} returned status ${res.statusCode}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`Health check failed for ${url}:`, err.message);
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  console.error(`Health check timed out after ${TIMEOUT_MS}ms — ${url}`);
  process.exit(1);
});
