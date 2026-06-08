// src/middleware/toxicity.js — Request-time toxicity filtering

const { classifyContent, sanitizeText } = require('../utils/toxicityFilter');
const { AppError } = require('./error');
const { HTTP } = require('../constants/statusCodes');
const { logger } = require('../utils/logger');
const { prisma } = require('../config/db');

/**
 * Scan specified body fields for toxic/spam content.
 * On REJECT: block with 422.
 * On FLAG: allow through but set req.toxicityFlag for the controller to save.
 *
 * @param {string[]} fields — body fields to check, e.g. ['body', 'title']
 */
function checkToxicity(fields = ['body', 'title']) {
  return (req, res, next) => {
    if (process.env.ENABLE_TOXICITY_FILTER !== 'true') return next();

    const texts = fields
      .map((f) => req.body[f])
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .map(sanitizeText);

    if (texts.length === 0) return next();

    // Aggregate worst score across all fields
    let worstResult = { action: 'ALLOW', score: 0, reasons: [] };

    for (const text of texts) {
      const result = classifyContent(text);
      if (result.score > worstResult.score) {
        worstResult = result;
      }
    }

    if (worstResult.action === 'REJECT') {
      logger.warn(`Toxic content blocked — user: ${req.user?.id}, score: ${worstResult.score}, reasons: ${worstResult.reasons.join(', ')}`);
      return next(new AppError(
        'Your content was flagged as inappropriate and could not be posted',
        HTTP.UNPROCESSABLE_ENTITY,
        'CONTENT_REJECTED',
      ));
    }

    if (worstResult.action === 'FLAG') {
      logger.info(`Content flagged for review — user: ${req.user?.id}, score: ${worstResult.score}`);
      req.toxicityFlag = {
        isFlagged: true,
        score:     worstResult.score,
        reasons:   worstResult.reasons,
      };
    }

    return next();
  };
}

/**
 * Auto-report flagged content after creation.
 * Call this inside the controller after saving the entity.
 */
async function autoReportFlagged({ reporterId, postId = null, commentId = null, resourceId = null }) {
  try {
    await prisma.report.create({
      data: {
        reporterId,
        reason:      'SPAM',
        description: 'Auto-flagged by toxicity filter',
        status:      'PENDING',
        postId,
        commentId,
        resourceId,
      },
    });
  } catch (err) {
    logger.error(`Auto-report failed: ${err.message}`);
  }
}

module.exports = { checkToxicity, autoReportFlagged };
