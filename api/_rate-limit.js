/**
 * Sliding Window In-Memory & Distributed-Ready Rate Limiter
 * Provides IP-based rate limiting with progressive cooldowns.
 */

import { getClientIp, logSecurityEvent } from './_logger.js';

// Global request store for the serverless container instance
const requestBuckets = new Map();

// Progressive violation penalty trackers
const violationTracker = new Map();

// Sweep stale buckets every 5 minutes to prevent memory leak
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStaleBuckets() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, bucket] of requestBuckets.entries()) {
    if (now - bucket.resetTime > 60000) {
      requestBuckets.delete(key);
    }
  }

  for (const [key, record] of violationTracker.entries()) {
    if (now - record.lastViolation > 30 * 60 * 1000) {
      violationTracker.delete(key);
    }
  }
}

/**
 * Enforces rate limit on a request
 * @param {object} req Incoming HTTP request
 * @param {object} res Outgoing HTTP response
 * @param {object} options Rate limit configuration
 *   - limit: maximum requests allowed in window
 *   - windowMs: window duration in milliseconds
 *   - endpoint: name for logging
 * @returns {boolean} True if request is allowed, false if rejected with 429
 */
export function checkRateLimit(req, res, options = {}) {
  cleanupStaleBuckets();

  const ip = getClientIp(req);
  const endpoint = options.endpoint || 'api';
  const limit = options.limit || 60;
  const windowMs = options.windowMs || 60 * 1000;
  const bucketKey = `${endpoint}:${ip}`;
  const now = Date.now();

  // Check progressive cooldown
  const violation = violationTracker.get(bucketKey);
  if (violation && violation.blockedUntil && now < violation.blockedUntil) {
    const retryAfterSeconds = Math.ceil((violation.blockedUntil - now) / 1000);
    res.setHeader('Retry-After', retryAfterSeconds);
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', Math.ceil(violation.blockedUntil / 1000));
    logSecurityEvent('RATE_LIMIT_COOLDOWN_ACTIVE', {
      req,
      status: 'RATE_LIMITED',
      meta: { endpoint, ip, retryAfter: retryAfterSeconds }
    });
    res.status(429).json({
      error: 'Too many requests. Temporary cooldown active.',
      retryAfterSeconds
    });
    return false;
  }

  let bucket = requestBuckets.get(bucketKey);
  if (!bucket || now >= bucket.resetTime) {
    bucket = {
      count: 1,
      resetTime: now + windowMs
    };
    requestBuckets.set(bucketKey, bucket);
  } else {
    bucket.count++;
  }

  const remaining = Math.max(0, limit - bucket.count);
  const resetSeconds = Math.ceil(bucket.resetTime / 1000);

  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetSeconds);

  if (bucket.count > limit) {
    // Record violation and trigger progressive cooldown (15s, 60s, 300s...)
    const currentViolations = (violation?.count || 0) + 1;
    const cooldownMultiplier = Math.min(currentViolations, 5);
    const cooldownMs = Math.min(windowMs * cooldownMultiplier, 15 * 60 * 1000);
    const blockedUntil = now + cooldownMs;

    violationTracker.set(bucketKey, {
      count: currentViolations,
      blockedUntil,
      lastViolation: now
    });

    const retryAfter = Math.ceil(cooldownMs / 1000);
    res.setHeader('Retry-After', retryAfter);

    logSecurityEvent('RATE_LIMIT_EXCEEDED', {
      req,
      status: 'RATE_LIMITED',
      meta: { endpoint, ip, requestCount: bucket.count, limit, cooldownSeconds: retryAfter }
    });

    res.status(429).json({
      error: 'Rate limit exceeded. Please slow down.',
      limit,
      retryAfterSeconds: retryAfter
    });
    return false;
  }

  return true;
}
