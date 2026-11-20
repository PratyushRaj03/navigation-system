import fs from 'fs';
import path from 'path';

const BUNDLED_DATA_PATH = path.join(process.cwd(), 'data', 'outlets.csv');
const TMP_DATA_PATH = path.join('/tmp', 'outlets.csv');

export function getDataFilePath() {
  try {
    if (!fs.existsSync(TMP_DATA_PATH)) {
      if (fs.existsSync(BUNDLED_DATA_PATH)) {
        fs.copyFileSync(BUNDLED_DATA_PATH, TMP_DATA_PATH);
      }
    }
    return TMP_DATA_PATH;
  } catch (_) {
    return BUNDLED_DATA_PATH;
  }
}

export function getDatasetStats() {
  const filePath = getDataFilePath();
  if (!fs.existsSync(filePath)) {
    return { error: 'Database file not found', totalStores: 0 };
  }

  const stat = fs.statSync(filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n');

  if (lines.length < 2) {
    return { totalStores: 0, validStores: 0, customers: 0, districts: [], lastModified: stat.mtime };
  }

  const header = lines[0].split(',').map(h => h.trim().toUpperCase());
  const distIdx = header.findIndex(h => h.includes('DIST'));
  const custIdx = header.findIndex(h => h.includes('CUST'));
  const typeIdx = header.findIndex(h => h.includes('KEYACC') || h.includes('TYPE') || h.includes('DESC'));
  const latIdx = header.findIndex(h => h.includes('LAT'));
  const lonIdx = header.findIndex(h => h.includes('LON'));

  const customers = new Set();
  const districts = new Set();
  const types = new Set();
  let validStores = 0;
  let invalidStores = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    if (row.length >= 5) {
      const dist = distIdx !== -1 && row[distIdx] ? row[distIdx].trim() : 'Unassigned';
      const cust = row[custIdx] ? row[custIdx].trim().toUpperCase() : '';
      const type = typeIdx !== -1 && row[typeIdx] ? row[typeIdx].trim() : 'Standard';
      const lat = parseFloat(row[latIdx]);
      const lng = parseFloat(row[lonIdx]);

      const isValid = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && cust.length > 0;

      if (isValid) {
        validStores++;
        customers.add(cust);
        districts.add(dist);
        types.add(type);
      } else {
        invalidStores++;
      }
    } else {
      invalidStores++;
    }
  }

  return {
    totalStores: lines.length - 1,
    validStores,
    invalidStores,
    uniqueCustomersCount: customers.size,
    districts: Array.from(districts).sort(),
    types: Array.from(types).sort(),
    fileSizeBytes: stat.size,
    lastModified: stat.mtime.toISOString()
  };
}
