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
    const { distName, custName, outletType, lat, lng } = req.body || {};

    if (!custName || !lat || !lng) {
      return res.status(400).json({ error: 'Customer Name, Latitude, and Longitude are required' });
    }

    const cleanDist = (distName || 'DB 1').replace(/,/g, ' ');
    const cleanCust = custName.replace(/,/g, ' ').replace(/"/g, '""');
    const cleanType = (outletType || 'VISI').replace(/,/g, ' ');
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);

    if (isNaN(parsedLat) || isNaN(parsedLng)) {
      return res.status(400).json({ error: 'Invalid numeric coordinates' });
    }

    const filePath = getDataFilePath();
    const newRow = `\n${cleanDist},"${cleanCust}",${cleanType},${parsedLat},${parsedLng}`;
    fs.appendFileSync(filePath, newRow, 'utf8');

    const stats = getDatasetStats();
    return res.status(200).json({
      success: true,
      message: `Store '${custName}' added successfully!`,
      stats
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
