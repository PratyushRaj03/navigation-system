import fs from 'fs';
import { getDataFilePath, getDatasetStats } from './_db.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { csvContent, mode } = req.body || {};

    if (!csvContent || typeof csvContent !== 'string') {
      return res.status(400).json({ error: 'csvContent string is required' });
    }

    const filePath = getDataFilePath();
    let finalContent = '';

    if (mode === 'append' && fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf8').trim();
      const newLines = csvContent.trim().split('\n');
      const rowsToAppend = newLines[0].toUpperCase().includes('DIST') ? newLines.slice(1) : newLines;
      finalContent = existing + '\n' + rowsToAppend.join('\n') + '\n';
    } else {
      finalContent = csvContent.trim() + '\n';
    }

    fs.writeFileSync(filePath, finalContent, 'utf8');

    const updatedStats = getDatasetStats();
    return res.status(200).json({
      success: true,
      message: `Database successfully ${mode === 'append' ? 'appended' : 'replaced'}!`,
      stats: updatedStats
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
