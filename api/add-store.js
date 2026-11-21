/**
 * Hardened Single Store Creation API Endpoint
 * Requires Operator or Admin Authorization, enforces rate limiting,
 * coordinate bounds validation (-90..90, -180..180), and formula injection sanitization.
 */

import fs from 'fs';
import { getDataFilePath, getDatasetStats } from './_db.js';
import { requireRole, ROLES } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';
import { logSecurityEvent } from './_logger.js';
import { sanitizeCsvCell, validateCoordinates, sanitizeString } from './_security.js';

export default function handler(req, res) {
  if (handleCors(req, res, { methods: 'POST, OPTIONS' })) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Enforce RBAC: Operator or Admin role required
  if (!requireRole(req, res, ROLES.OPERATOR)) {
    return;
  }

  // 2. Rate limiting: 60 store additions per hour per IP
  if (!checkRateLimit(req, res, { endpoint: 'add_store', limit: 60, windowMs: 60 * 60 * 1000 })) {
    return;
  }

  try {
    const { distName, custName, outletType, lat, lng } = req.body || {};

    if (!custName || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Customer Name, Latitude, and Longitude are required' });
    }

    const cleanCustName = sanitizeString(custName, 150);
    if (cleanCustName.length < 2) {
      return res.status(400).json({ error: 'Customer Name must be at least 2 characters' });
    }

    // 3. Coordinate Bounds Validation
    const coordVal = validateCoordinates(lat, lng, false);
    if (!coordVal.valid) {
      return res.status(400).json({ error: `Invalid coordinates: ${coordVal.reason}` });
    }

    // 4. Formula Injection Defense
    const cleanDist = sanitizeCsvCell(sanitizeString(distName || 'DB 1', 50));
    const safeCust = sanitizeCsvCell(cleanCustName).replace(/"/g, '""');
    const cleanType = sanitizeCsvCell(sanitizeString(outletType || 'VISI', 50));

    const filePath = getDataFilePath();
    const newRow = `\n${cleanDist},"${safeCust}",${cleanType},${coordVal.lat},${coordVal.lng}`;
    fs.appendFileSync(filePath, newRow, 'utf8');

    const stats = getDatasetStats();

    logSecurityEvent('STORE_CREATED', {
      req,
      status: 'SUCCESS',
      meta: {
        custName: cleanCustName,
        distName: cleanDist,
        lat: coordVal.lat,
        lng: coordVal.lng
      }
    });

    return res.status(200).json({
      success: true,
      message: `Store '${cleanCustName}' added successfully!`,
      stats
    });

  } catch (err) {
    logSecurityEvent('STORE_CREATION_ERROR', {
      req,
      status: 'ERROR',
      meta: { error: err.message }
    });
    return res.status(500).json({ error: 'Failed to create store record.' });
  }
}
