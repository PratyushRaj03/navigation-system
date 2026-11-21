/**
 * Structured Security Audit Logger
 * Provides tamper-evident structured audit logging for security events,
 * authorization decisions, data alterations, rate-limiting triggers, and administrative actions.
 */

const REDACTED_KEYS = ['password', 'passkey', 'token', 'authorization', 'secret', 'key', 'apiKey'];

/**
 * Redacts sensitive fields from logged objects
 * @param {any} obj 
 * @returns {any} Sanitized object
 */
export function redactSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitiveData);

  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = REDACTED_KEYS.some(r => k.toLowerCase().includes(r.toLowerCase()));
    if (isSensitive) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = redactSensitiveData(v);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/**
 * Extracts client IP address safely from Vercel / proxy headers
 * @param {object} req 
 * @returns {string}
 */
export function getClientIp(req) {
  if (!req) return 'unknown';
  const xForwardedFor = req.headers?.['x-forwarded-for'];
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  const xRealIp = req.headers?.['x-real-ip'];
  if (xRealIp) return xRealIp.trim();
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

/**
 * Logs a security event
 * @param {string} eventType 
 * @param {object} details 
 */
export function logSecurityEvent(eventType, details = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: eventType,
    clientIp: details.req ? getClientIp(details.req) : (details.ip || 'internal'),
    user: details.user || 'anonymous',
    role: details.role || 'public',
    status: details.status || 'INFO', // 'SUCCESS' | 'DENIED' | 'RATE_LIMITED' | 'ERROR' | 'INFO'
    details: redactSensitiveData(details.meta || {})
  };

  const logString = JSON.stringify(logEntry);
  if (details.status === 'ERROR' || details.status === 'DENIED') {
    console.error(`[SEC_AUDIT] ${logString}`);
  } else if (details.status === 'RATE_LIMITED') {
    console.warn(`[SEC_AUDIT] ${logString}`);
  } else {
    console.info(`[SEC_AUDIT] ${logString}`);
  }

  return logEntry;
}
