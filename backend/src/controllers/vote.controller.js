// src/controllers/vote.controller.js

const voteService = require('../services/vote.service');
const { successResponse } = require('../utils/response');
const { validateBody }    = require('../middleware/validation');
const { z }               = require('zod');

/**
 * @swagger
 * /votes:
 *   post:
 *     summary: Cast, switch, or remove a vote on a post or comment
 *     tags: [Votes]
 *     description: |
 *       Idempotent toggle — posting the same voteType removes it.
 *       Returns the new vote state and fresh counts.
 */
async function castVote(req, res) {
  const result = await voteService.castVote(req.user.id, req.body);
  const actionMsg = {
    created:  'Vote cast',
    removed:  'Vote removed',
    switched: 'Vote updated',
  }[result.action] ?? 'Vote processed';

  return successResponse(res, { message: actionMsg, data: result });
}

/**
 * @swagger
 * /votes/my-votes:
 *   post:
 *     summary: Batch-fetch the current user's votes for a set of posts/comments
 *     tags: [Votes]
 *     description: Send arrays of postIds and/or commentIds; receive maps of id → voteType
 */
async function getUserVotes(req, res) {
  const { postIds = [], commentIds = [] } = req.body;
  const result = await voteService.getUserVotes(req.user.id, { postIds, commentIds });
  return successResponse(res, { message: 'User votes fetched', data: result });
}

module.exports = { castVote, getUserVotes };
