import fs from 'fs';
import { getDataFilePath } from './_db.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const filePath = getDataFilePath();
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }
    const data = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="outlets_export.csv"');
    return res.status(200).send(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
