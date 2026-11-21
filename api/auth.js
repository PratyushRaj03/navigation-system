/**
 * Authentication API Endpoint
 * Handles login, session token verification, role inspection, and passkey management.
 */

import { authenticateCredentials, signToken, getAuthenticatedUser, requireRole, ROLES } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';
import { logSecurityEvent } from './_logger.js';
import { sanitizeString } from './_security.js';

export default async function handler(req, res) {
  if (handleCors(req, res, { methods: 'GET, POST, OPTIONS' })) {
    return;
  }

  const { action = 'verify' } = req.query || {};

  // Action: LOGIN
  if (req.method === 'POST' && action === 'login') {
    // Strict rate limiting on authentication to prevent brute force
    if (!checkRateLimit(req, res, { endpoint: 'auth_login', limit: 8, windowMs: 15 * 60 * 1000 })) {
      return;
    }

    try {
      const { username, passkey } = req.body || {};
      const cleanUser = sanitizeString(username, 50);
      const cleanPasskey = sanitizeString(passkey, 100);

      const authResult = authenticateCredentials(cleanUser, cleanPasskey);

      if (!authResult.authenticated) {
        logSecurityEvent('AUTH_FAILURE', {
          req,
          status: 'DENIED',
          user: cleanUser || 'unknown',
          meta: { reason: 'Invalid credentials' }
        });
        // Uniform error message against account enumeration
        return res.status(401).json({
          authenticated: false,
          error: 'Invalid username or security passkey'
        });
      }

      // Generate signed token with 8-hour expiration
      const token = signToken({
        username: authResult.username,
        role: authResult.role
      }, 8 * 3600);

      logSecurityEvent('AUTH_SUCCESS', {
        req,
        status: 'SUCCESS',
        user: authResult.username,
        role: authResult.role
      });

      return res.status(200).json({
        authenticated: true,
        token,
        role: authResult.role,
        username: authResult.username,
        expiresInSeconds: 8 * 3600
      });
    } catch (err) {
      logSecurityEvent('AUTH_ERROR', { req, status: 'ERROR', meta: { error: err.message } });
      return res.status(500).json({ error: 'Authentication service temporarily unavailable' });
    }
  }

  // Action: VERIFY TOKEN
  if (req.method === 'GET' && action === 'verify') {
    const auth = getAuthenticatedUser(req);
    if (!auth.authenticated) {
      return res.status(200).json({
        authenticated: false,
        role: ROLES.VIEWER,
        error: auth.error
      });
    }

    return res.status(200).json({
      authenticated: true,
      role: auth.role,
      user: auth.user
    });
  }

  // Action: LOGOUT
  if (req.method === 'POST' && action === 'logout') {
    const auth = getAuthenticatedUser(req);
    logSecurityEvent('AUTH_LOGOUT', {
      req,
      status: 'INFO',
      user: auth.user || 'anonymous'
    });
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  }

  return res.status(400).json({ error: 'Unsupported auth action' });
}
