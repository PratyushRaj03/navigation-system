/**
 * Hardened Dataset Export API Endpoint
 * Requires Admin Authorization to prevent unauthorized extraction of proprietary store data,
 * applies rate limiting, and neutralizes CSV formula injection before file delivery.
 */

import fs from 'fs';
import { getDataFilePath } from './_db.js';
import { requireRole, ROLES } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';
import { logSecurityEvent } from './_logger.js';
import { sanitizeCsvCell } from './_security.js';

export default function handler(req, res) {
  if (handleCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Enforce RBAC: Admin Role Required for full data export
  if (!requireRole(req, res, ROLES.ADMIN)) {
    return;
  }

  // 2. Rate limiting: 15 exports per hour per IP
  if (!checkRateLimit(req, res, { endpoint: 'dataset_export', limit: 15, windowMs: 60 * 60 * 1000 })) {
    return;
  }

  try {
    const filePath = getDataFilePath();
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }

    const rawData = fs.readFileSync(filePath, 'utf8');
    const lines = rawData.trim().split(/\r?\n/);

    if (lines.length === 0) {
      return res.status(200).send('');
    }

    // Neutralize any formula injection triggers in export
    const safeLines = [];
    safeLines.push(lines[0]); // Header

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const parts = line.split(',');
      if (parts.length >= 5) {
        const dist = sanitizeCsvCell(parts[0]);
        const cust = sanitizeCsvCell(parts[1].replace(/^"|"$/g, '')).replace(/"/g, '""');
        const type = sanitizeCsvCell(parts[2]);
        const lat = parts[3].trim();
        const lng = parts[4].trim();
        safeLines.push(`${dist},"${cust}",${type},${lat},${lng}`);
      } else {
        safeLines.push(line);
      }
    }

    const sanitizedCsv = safeLines.join('\n');

    logSecurityEvent('DATASET_EXPORTED', {
      req,
      status: 'SUCCESS',
      meta: { lineCount: safeLines.length }
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="outlets_export_secure.csv"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.status(200).send(sanitizedCsv);

  } catch (err) {
    logSecurityEvent('DATASET_EXPORT_ERROR', {
      req,
      status: 'ERROR',
      meta: { error: err.message }
    });
    return res.status(500).json({ error: 'Failed to export dataset.' });
  }
}
