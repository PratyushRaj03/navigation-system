/**
 * CORS Security Module
 * Strict Origin Validation, safe method and header whitelists.
 */

const ALLOWED_ORIGINS = [
  'https://navigation-system3.vercel.app',
  'https://admin-site.vercel.app'
];

/**
 * Checks if origin is trusted
 * @param {string} origin 
 * @param {object} req 
 * @returns {boolean}
 */
export function isAllowedOrigin(origin, req) {
  if (!origin) return true; // Same-origin / direct browser requests often have no Origin header

  // Explicit allowed list
  if (ALLOWED_ORIGINS.includes(origin)) return true;

  // Local development
  if (
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:') ||
    origin.startsWith('https://localhost:')
  ) {
    return true;
  }

  // Vercel preview deployments for this project
  if (origin.endsWith('.vercel.app') && origin.includes('navigation-system')) {
    return true;
  }

  return false;
}

/**
 * Applies secure CORS headers to response
 * @param {object} req 
 * @param {object} res 
 * @param {object} options
 * @returns {boolean} True if handled (e.g. OPTIONS), false to continue
 */
export function handleCors(req, res, options = {}) {
  const origin = req.headers?.origin;
  const allowed = isAllowedOrigin(origin, req);

  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // Same origin or curl/server-side
    res.setHeader('Access-Control-Allow-Origin', 'https://navigation-system3.vercel.app');
  } else {
    // Disallow untrusted origin from credentialed/wildcard access
    res.setHeader('Access-Control-Allow-Origin', 'null');
  }

  const methods = options.methods || 'GET, POST, OPTIONS';
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Admin-Token');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }

  return false;
}
