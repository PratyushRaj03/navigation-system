/**
 * Hardened Dataset Stats API Endpoint
 * Provides aggregated metadata with rate limiting and secure headers.
 */

import { getDatasetStats } from './_db.js';
import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';

export default function handler(req, res) {
  if (handleCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  // Rate Limiting: 120 calls per minute per IP
  if (!checkRateLimit(req, res, { endpoint: 'stats', limit: 120, windowMs: 60 * 1000 })) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const stats = getDatasetStats();
    return res.status(200).json(stats);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve dataset statistics' });
  }
}
