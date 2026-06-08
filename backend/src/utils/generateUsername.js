// src/utils/generateUsername.js — Anonymous alias and username generation

const { prisma } = require('../config/db');

// Word banks for generating memorable anonymous aliases
const ADJECTIVES = [
  'Cosmic', 'Silent', 'Neon', 'Cryptic', 'Swift', 'Aurora', 'Quantum', 'Phantom',
  'Nebula', 'Radiant', 'Stealth', 'Eclipse', 'Velvet', 'Prism', 'Hollow', 'Mystic',
  'Vivid', 'Arcane', 'Lucid', 'Zenith', 'Apex', 'Solar', 'Lunar', 'Ember',
  'Blazing', 'Frozen', 'Iron', 'Golden', 'Silver', 'Crimson',
];

const NOUNS = [
  'Panda', 'Falcon', 'Owl', 'Tiger', 'Phoenix', 'Dragon', 'Storm', 'Byte',
  'Cipher', 'Matrix', 'Vertex', 'Nexus', 'Orbit', 'Pulse', 'Vector', 'Quark',
  'Raven', 'Comet', 'Nova', 'Spark', 'Hawk', 'Wolf', 'Bear', 'Fox',
  'Coder', 'Ninja', 'Ghost', 'Shadow', 'Vortex', 'Synapse',
];

/**
 * Generate a random anonymous alias like "CrypticOwl#4821"
 */
function generateAnonymousAlias() {
  const adj  = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num  = String(Math.floor(Math.random() * 9000) + 1000);
  return `${adj}${noun}#${num}`;
}

/**
 * Generate a unique anonymous alias (checks DB for collisions)
 */
async function generateUniqueAnonymousAlias() {
  let alias;
  let attempts = 0;
  const maxAttempts = 10;

  do {
    alias = generateAnonymousAlias();
    const existing = await prisma.user.findUnique({ where: { anonymousAlias: alias } });
    if (!existing) return alias;
    attempts++;
  } while (attempts < maxAttempts);

  // Fallback: append timestamp to guarantee uniqueness
  return `${generateAnonymousAlias()}-${Date.now()}`;
}

/**
 * Sanitize a display name into a valid username base
 * e.g. "Ananya Sharma" -> "ananya_sharma"
 */
function sanitizeUsername(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20);
}

/**
 * Generate a unique username from a display name
 */
async function generateUniqueUsername(displayName) {
  const base = sanitizeUsername(displayName);
  let candidate = base;
  let suffix = 1;

  while (true) {
    const existing = await prisma.user.findUnique({ where: { username: candidate } });
    if (!existing) return candidate;
    candidate = `${base}_${suffix++}`;
  }
}

module.exports = {
  generateAnonymousAlias,
  generateUniqueAnonymousAlias,
  generateUniqueUsername,
  sanitizeUsername,
};
