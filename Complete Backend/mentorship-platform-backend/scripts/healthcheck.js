#!/usr/bin/env node

const http = require('http');

const PORT = process.env.PORT ?? 5000;

const req = http.get(`http://localhost:${PORT}/health`, { timeout: 3000 }, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log('Healthy:', data);
      process.exit(0);
    } else {
      console.error(`Unhealthy — status ${res.statusCode}`);
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error('Health check failed:', err.message);
  process.exit(1);
});

req.on('timeout', () => {
  req.destroy();
  console.error('Health check timed out');
  process.exit(1);
});
