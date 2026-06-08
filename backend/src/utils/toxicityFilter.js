// src/utils/toxicityFilter.js — Offensive language + spam detection

// Expandable list — in production consider a proper ML API (Perspective, OpenAI Moderation)
const TOXIC_PATTERNS = [
  // Slurs and hate speech patterns (abbreviated — expand for production)
  /\b(fuck|shit|bastard|asshole|bitch|cunt|dick|pussy|whore|nigger|faggot)\b/i,
  // Harassment patterns
  /\b(kill yourself|kys|die in a fire|go hang yourself)\b/i,
  // Spam patterns
  /(https?:\/\/\S+){3,}/i,                    // 3+ URLs
  /(.)\1{9,}/i,                               // 10+ repeated characters
  /\b(buy now|click here|free money|earn \$|make money fast)\b/i,
];

const SPAM_PATTERNS = [
  /(.{20,})\1{2,}/i,                          // repeated long phrases
  /[A-Z]{15,}/,                               // excessive caps
  /\b(\w+)\s+\1\s+\1\b/i,                    // word repeated 3 times
];

// Score thresholds
const TOXICITY_THRESHOLD = 0.6; // 0-1 score above which content is flagged

/**
 * Analyse text for toxicity
 * Returns { isToxic, score, reasons }
 */
function analyseText(text) {
  if (!text || typeof text !== 'string') {
    return { isToxic: false, score: 0, reasons: [] };
  }

  const reasons = [];
  let score = 0;

  // Pattern matching
  for (const pattern of TOXIC_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push('offensive_language');
      score += 0.8;
      break;
    }
  }

  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) {
      reasons.push('spam_detected');
      score += 0.5;
      break;
    }
  }

  // Excessive link density
  const urlCount = (text.match(/https?:\/\/\S+/g) ?? []).length;
  if (urlCount > 3) {
    reasons.push('link_spam');
    score += 0.4;
  }

  // Very short with all caps
  if (text.length < 50 && text === text.toUpperCase() && /[A-Z]{5,}/.test(text)) {
    reasons.push('all_caps');
    score += 0.2;
  }

  score = Math.min(score, 1); // clamp to [0, 1]
  const isToxic = score >= TOXICITY_THRESHOLD;

  return { isToxic, score: parseFloat(score.toFixed(2)), reasons };
}

/**
 * Check if content should be auto-rejected vs flagged for review
 */
function classifyContent(text) {
  const result = analyseText(text);

  if (result.score >= 0.8) {
    return { ...result, action: 'REJECT' };     // Block immediately
  }
  if (result.score >= TOXICITY_THRESHOLD) {
    return { ...result, action: 'FLAG' };       // Allow but flag for review
  }
  return { ...result, action: 'ALLOW' };
}

/**
 * Sanitize text — strip HTML tags, trim whitespace
 */
function sanitizeText(text) {
  return text
    .replace(/<[^>]*>/g, '')                   // strip HTML
    .replace(/\s+/g, ' ')                      // normalise whitespace
    .trim();
}

module.exports = { analyseText, classifyContent, sanitizeText, TOXICITY_THRESHOLD };
