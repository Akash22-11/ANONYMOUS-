// src/constants/tags.js — Canonical tag slugs used across the platform

const TAGS = Object.freeze({
  DSA:           'dsa',
  PLACEMENT:     'placement',
  WEB_DEV:       'web-dev',
  SYSTEM_DESIGN: 'system-design',
  DBMS:          'dbms',
  OS:            'os',
  CN:            'cn',
  REACT:         'react',
  NODEJS:        'nodejs',
  PYTHON:        'python',
  ML:            'ml',
  RESUME:        'resume',
  INTERNSHIP:    'internship',
  CGPA:          'cgpa',
  OPEN_SOURCE:   'open-source',
});

const MAX_TAGS_PER_POST     = 5;
const MAX_TAGS_PER_RESOURCE = 5;

module.exports = { TAGS, MAX_TAGS_PER_POST, MAX_TAGS_PER_RESOURCE };
