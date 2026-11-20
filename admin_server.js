/**
 * Dedicated Admin Portal HTTP Server & Database Management API
 * Runs on Port 8081 (Separated from main application on Port 8080)
 * Provides dataset stats, file upload, append/replace, and single-store insertion.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 8081;
const DATA_FILE_PATH = path.join(__dirname, 'data', 'outlets.csv');
const BACKUP_FILE_PATH = path.join(__dirname, 'data', 'outlets_backup.csv');

// MIME types for static assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Calculates live database statistics from the current CSV file
 */
function getDatasetStats() {
  if (!fs.existsSync(DATA_FILE_PATH)) {
    return { error: 'Database file not found', totalStores: 0 };
  }

  const stat = fs.statSync(DATA_FILE_PATH);
  const content = fs.readFileSync(DATA_FILE_PATH, 'utf8');
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

/**
 * Handles incoming JSON payload
 */
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // Protect against oversized payload (max 50MB)
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Request Handler
 */
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 1: Get Current Database Stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    try {
      const stats = getDatasetStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API 2: Get Current Raw CSV Dataset
  if (pathname === '/api/dataset' && req.method === 'GET') {
    try {
      if (!fs.existsSync(DATA_FILE_PATH)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database file not found' }));
        return;
      }
      const data = fs.readFileSync(DATA_FILE_PATH, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="outlets_export.csv"'
      });
      res.end(data);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API 3: Save / Update Dataset (Replace or Append)
  if (pathname === '/api/save-dataset' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const { csvContent, mode } = body; // mode: 'replace' | 'append'

      if (!csvContent || typeof csvContent !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'csvContent string is required' }));
        return;
      }

      // Create a backup of existing file if it exists
      if (fs.existsSync(DATA_FILE_PATH)) {
        fs.copyFileSync(DATA_FILE_PATH, BACKUP_FILE_PATH);
      }

      let finalContent = '';

      if (mode === 'append' && fs.existsSync(DATA_FILE_PATH)) {
        const existing = fs.readFileSync(DATA_FILE_PATH, 'utf8').trim();
        const newLines = csvContent.trim().split('\n');
        // Strip header from new lines if present
        const rowsToAppend = newLines[0].toUpperCase().includes('DIST') ? newLines.slice(1) : newLines;
        finalContent = existing + '\n' + rowsToAppend.join('\n') + '\n';
      } else {
        // Replace
        finalContent = csvContent.trim() + '\n';
      }

      fs.writeFileSync(DATA_FILE_PATH, finalContent, 'utf8');

      const updatedStats = getDatasetStats();
      console.log(`[AdminServer] Dataset updated (${mode}). Total stores: ${updatedStats.totalStores}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: `Database successfully ${mode === 'append' ? 'appended' : 'replaced'}!`,
        stats: updatedStats
      }));
    } catch (err) {
      console.error('[AdminServer Error]', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API 4: Add Single Store Record
  if (pathname === '/api/add-store' && req.method === 'POST') {
    try {
      const store = await parseJsonBody(req);
      const { distName, custName, outletType, lat, lng } = store;

      if (!custName || !lat || !lng) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Customer Name, Latitude, and Longitude are required' }));
        return;
      }

      const cleanDist = (distName || 'DB 1').replace(/,/g, ' ');
      const cleanCust = custName.replace(/,/g, ' ').replace(/"/g, '""');
      const cleanType = (outletType || 'VISI').replace(/,/g, ' ');
      const parsedLat = parseFloat(lat);
      const parsedLng = parseFloat(lng);

      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid numeric coordinates' }));
        return;
      }

      const newRow = `\n${cleanDist},"${cleanCust}",${cleanType},${parsedLat},${parsedLng}`;
      fs.appendFileSync(DATA_FILE_PATH, newRow, 'utf8');

      const stats = getDatasetStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        message: `Store '${custName}' added successfully!`,
        stats
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static File Serving for Admin Portal
  let filePath = '';
  if (pathname === '/' || pathname === '/index.html' || pathname === '/admin' || pathname === '/admin/') {
    filePath = path.join(__dirname, 'admin', 'index.html');
  } else if (pathname.startsWith('/admin/')) {
    filePath = path.join(__dirname, pathname);
  } else {
    filePath = path.join(__dirname, 'admin', pathname);
  }

  // Fallback check in project root if file exists there
  if (!fs.existsSync(filePath)) {
    const altPath = path.join(__dirname, pathname);
    if (fs.existsSync(altPath) && fs.statSync(altPath).isFile()) {
      filePath = altPath;
    }
  }

  const extname = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>404 Not Found</h1><p>The requested file <code>${pathname}</code> was not found on Admin Server.</p>`);
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  FLEETNAV ADMIN PORTAL SERVER RUNNING ON PORT ${PORT}`);
  console.log(`  Access Admin Portal at: http://localhost:${PORT}`);
  console.log(`  Main App running at:    http://localhost:8080`);
  console.log(`=======================================================`);
});
