// src/controllers/mentor.controller.js

const mentorService = require('../services/mentor.service');
const { successResponse, createdResponse, paginatedResponse } = require('../utils/response');
const { parsePaginationParams } = require('../utils/pagination');

/**
 * @swagger
 * /mentors:
 *   get:
 *     summary: Browse the mentor directory with filters
 *     tags: [Mentors]
 */
async function getMentors(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { expertise, company, available, search, sortBy } = req.query;

  const { mentors, pagination } = await mentorService.getMentors({
    page, limit, expertise, company,
    available: available !== undefined ? available === 'true' : undefined,
    search, sortBy,
  });

  return paginatedResponse(res, { message: 'Mentors fetched', data: mentors, pagination });
}

/**
 * @swagger
 * /mentors/{id}:
 *   get:
 *     summary: Get a mentor's public profile by mentor profile ID
 *     tags: [Mentors]
 */
async function getMentorById(req, res) {
  const mentor = await mentorService.getMentorById(req.params.id);
  return successResponse(res, { message: 'Mentor fetched', data: mentor });
}

/**
 * @swagger
 * /mentors/requests:
 *   post:
 *     summary: Submit a mentorship request
 *     tags: [Mentors]
 */
async function createRequest(req, res) {
  const request = await mentorService.createRequest(req.user.id, req.body);
  return createdResponse(res, {
    message: 'Mentorship request submitted. The mentor will be notified.',
    data:    request,
  });
}

/**
 * @swagger
 * /mentors/requests:
 *   get:
 *     summary: List mentorship requests (as mentee or mentor)
 *     tags: [Mentors]
 */
async function getRequests(req, res) {
  const { page, limit } = parsePaginationParams(req.query);
  const { status, role } = req.query;

  const { requests, pagination } = await mentorService.getRequests(req.user.id, {
    page, limit, status, role: role ?? 'mentee',
  });

  return paginatedResponse(res, { message: 'Requests fetched', data: requests, pagination });
}

/**
 * @swagger
 * /mentors/requests/{id}/respond:
 *   patch:
 *     summary: Accept or decline a mentorship request (mentor only)
 *     tags: [Mentors]
 */
async function respondToRequest(req, res) {
  const updated = await mentorService.respondToRequest(
    req.user.id,
    req.params.id,
    req.body,
  );

  const actionLabel = req.body.action === 'accept' ? 'accepted' : 'declined';
  return successResponse(res, {
    message: `Request ${actionLabel} successfully`,
    data:    updated,
  });
}

/**
 * @swagger
 * /mentors/requests/{id}/cancel:
 *   patch:
 *     summary: Cancel your own pending request (requester only)
 *     tags: [Mentors]
 */
async function cancelRequest(req, res) {
  const updated = await mentorService.cancelRequest(req.user.id, req.params.id);
  return successResponse(res, { message: 'Request cancelled', data: updated });
}

/**
 * @swagger
 * /mentors/requests/{id}/feedback:
 *   post:
 *     summary: Submit rating and feedback for a completed session (mentee only)
 *     tags: [Mentors]
 */
async function submitFeedback(req, res) {
  const result = await mentorService.submitFeedback(req.user.id, req.params.id, req.body);
  return createdResponse(res, { message: 'Feedback submitted. Thank you!', data: result });
}

/**
 * @swagger
 * /mentors/requests/{id}/complete:
 *   patch:
 *     summary: Mark a session as completed (mentor only)
 *     tags: [Mentors]
 */
async function completeSession(req, res) {
  const result = await mentorService.completeSession(req.user.id, req.params.id);
  return successResponse(res, { message: result.message, data: result });
}

module.exports = {
  getMentors,
  getMentorById,
  createRequest,
  getRequests,
  respondToRequest,
  cancelRequest,
  submitFeedback,
  completeSession,
};
