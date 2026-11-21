/**
 * Hardened Save / Replace Dataset API Endpoint
 * Requires Admin Authorization, enforces rate limiting, CSV formula injection defense,
 * row/column limits, and coordinate bounds validation.
 */

import fs from 'fs';
import { getDataFilePath, getDatasetStats } from './_db.js';
import { requireRole, ROLES } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';
import { logSecurityEvent } from './_logger.js';
import { sanitizeCsvCell, validateCoordinates, sanitizeString } from './_security.js';

const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ALLOWED_ROWS = 10000;

export default function handler(req, res) {
  if (handleCors(req, res, { methods: 'POST, OPTIONS' })) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Enforce RBAC: Admin Role Required
  if (!requireRole(req, res, ROLES.ADMIN)) {
    return;
  }

  // 2. Enforce Rate Limiting (15 dataset saves per hour per IP)
  if (!checkRateLimit(req, res, { endpoint: 'save_dataset', limit: 15, windowMs: 60 * 60 * 1000 })) {
    return;
  }

  try {
    const { csvContent, mode } = req.body || {};

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ error: 'csvContent string is required' });
    }

    // 3. Payload Size Check
    if (Buffer.byteLength(csvContent, 'utf8') > MAX_CSV_SIZE_BYTES) {
      return res.status(413).json({ error: 'Payload exceeds maximum limit of 5MB' });
    }

    const rawLines = csvContent.trim().split(/\r?\n/);
    if (rawLines.length < 1) {
      return res.status(400).json({ error: 'CSV content contains no data' });
    }

    if (rawLines.length > MAX_ALLOWED_ROWS) {
      return res.status(400).json({
        error: `CSV row count (${rawLines.length}) exceeds maximum allowable limit of ${MAX_ALLOWED_ROWS} rows.`
      });
    }

    // 4. Parse Header & Detect Columns
    let startIndex = 0;
    const firstLine = rawLines[0].toUpperCase();
    const hasHeader = firstLine.includes('DIST') || firstLine.includes('CUST') || firstLine.includes('LAT');
    if (hasHeader) {
      startIndex = 1;
    }

    const sanitizedRows = [];
    let validCount = 0;
    let skippedCount = 0;

    for (let i = startIndex; i < rawLines.length; i++) {
      const line = rawLines[i].trim();
      if (!line) continue;

      // Handle simple CSV splitting with basic quotes
      const parts = line.split(',');
      if (parts.length < 5) {
        skippedCount++;
        continue;
      }

      const rawDist = sanitizeString(parts[0], 50);
      const rawCust = sanitizeString(parts[1].replace(/^"|"$/g, ''), 150);
      const rawType = sanitizeString(parts[2], 50);
      const rawLat = parts[3].trim();
      const rawLng = parts[4].trim();

      const coordVal = validateCoordinates(rawLat, rawLng, false);
      if (!coordVal.valid || !rawCust) {
        skippedCount++;
        continue;
      }

      // Neutralize Formula Injection on every text field
      const safeDist = sanitizeCsvCell(rawDist || 'DB 1');
      const safeCust = sanitizeCsvCell(rawCust).replace(/"/g, '""');
      const safeType = sanitizeCsvCell(rawType || 'VISI');

      sanitizedRows.push(`${safeDist},"${safeCust}",${safeType},${coordVal.lat},${coordVal.lng}`);
      validCount++;
    }

    if (sanitizedRows.length === 0) {
      return res.status(400).json({ error: 'No valid store records found in the uploaded content.' });
    }

    const filePath = getDataFilePath();
    let finalContent = '';

    if (mode === 'append' && fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf8').trim();
      finalContent = existing + '\n' + sanitizedRows.join('\n') + '\n';
    } else {
      // Replace: prepend standard header
      finalContent = 'DIST_NAME,CUST_NAME,KEYACCGRP2_DESC,LATITUDE,LONGITUDE\n' + sanitizedRows.join('\n') + '\n';
    }

    fs.writeFileSync(filePath, finalContent, 'utf8');

    const updatedStats = getDatasetStats();

    logSecurityEvent('DATASET_MUTATION_SUCCESS', {
      req,
      status: 'SUCCESS',
      meta: {
        mode: mode === 'append' ? 'append' : 'replace',
        validRows: validCount,
        skippedRows: skippedCount,
        totalDatabaseStores: updatedStats.totalStores
      }
    });

    return res.status(200).json({
      success: true,
      message: `Database successfully ${mode === 'append' ? 'appended' : 'replaced'} (${validCount} valid stores saved, ${skippedCount} invalid skipped).`,
      stats: updatedStats
    });

  } catch (err) {
    logSecurityEvent('DATASET_MUTATION_ERROR', {
      req,
      status: 'ERROR',
      meta: { error: err.message }
    });
    return res.status(500).json({ error: 'Failed to process dataset. An internal error occurred.' });
  }
}
