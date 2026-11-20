/**
 * Data Loading & RFC-4180 CSV Parser
 * Loads outlet data, validates geographic coordinates, computes statistics,
 * and establishes customer groupings and bounding box geometry.
 */

import { colorManager } from './colors.js';

export class DataLoader {
  constructor() {
    this.outlets = [];
    this.invalidRows = [];
    this.stats = {
      totalRows: 0,
      validOutlets: 0,
      invalidRecords: 0,
      uniqueCustomersCount: 0,
      uniqueDistrictsCount: 0,
      uniqueTypesCount: 0,
      bounds: null,
      center: null
    };
    this.customerMap = new Map(); // custName -> Array of outlets
    this.districtMap = new Map(); // distName -> Array of outlets
    this.typeMap = new Map();     // outletType -> Array of outlets
  }

  /**
   * RFC 4180 compliant CSV parser that correctly handles:
   * - Quoted fields containing commas
   * - Escaped quotes ("")
   * - CRLF (\r\n) and LF (\n) line endings
   * - Leading and trailing whitespace
   * @param {string} text 
   * @returns {Array<Array<string>>}
   */
  parseCSV(text) {
    const rows = [];
    let row = [''];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped double quote
          row[row.length - 1] += '"';
          i++;
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push('');
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          i++; // Skip \n in \r\n
        }
        if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
          rows.push(row);
        }
        row = [''];
      } else {
        row[row.length - 1] += char;
      }
    }

    if (row.length > 1 || (row.length === 1 && row[0].trim() !== '')) {
      rows.push(row);
    }

    return rows;
  }

  /**
   * Loads and parses the CSV from the specified path
   * @param {string} filePath 
   * @returns {Promise<object>} Loaded dataset and metadata
   */
  async loadData(filePath = './data/outlets.csv') {
    try {
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`Failed to load CSV from ${filePath} (HTTP ${response.status}: ${response.statusText})`);
      }

      const csvText = await response.text();
      return this.processCSV(csvText);
    } catch (error) {
      console.error('DataLoader Error:', error);
      throw error;
    }
  }

  /**
   * Processes raw CSV text into validated outlet objects
   * @param {string} csvText 
   * @returns {object}
   */
  processCSV(csvText) {
    const parsedRows = this.parseCSV(csvText);
    if (!parsedRows || parsedRows.length < 2) {
      throw new Error('CSV file is empty or does not contain a header and data rows.');
    }

    const header = parsedRows[0].map(h => h.trim().toUpperCase());
    const distIdx = header.findIndex(h => h.includes('DIST'));
    const custIdx = header.findIndex(h => h.includes('CUST'));
    const typeIdx = header.findIndex(h => h.includes('KEYACC') || h.includes('TYPE') || h.includes('DESC'));
    const latIdx = header.findIndex(h => h.includes('LAT'));
    const lonIdx = header.findIndex(h => h.includes('LON'));

    if (custIdx === -1 || latIdx === -1 || lonIdx === -1) {
      throw new Error(`CSV is missing required columns. Found headers: ${header.join(', ')}`);
    }

    this.outlets = [];
    this.invalidRows = [];
    this.customerMap = new Map(); // canonicalName -> Array of outlets
    this.customerDisplayNameMap = new Map(); // canonicalName -> prettiest Display Name
    this.districtMap = new Map(); // distName -> Array of outlets
    this.typeMap = new Map();     // outletType -> Array of outlets

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let latSum = 0, lngSum = 0;
    let outletId = 1;

    for (let i = 1; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      const distName = distIdx !== -1 && row[distIdx] ? row[distIdx].trim() : 'Unassigned';
      const custName = row[custIdx] ? row[custIdx].trim() : '';
      const outletType = typeIdx !== -1 && row[typeIdx] ? row[typeIdx].trim() : 'Standard';
      const rawLat = row[latIdx] ? row[latIdx].trim() : '';
      const rawLng = row[lonIdx] ? row[lonIdx].trim() : '';

      const lat = parseFloat(rawLat);
      const lng = parseFloat(rawLng);

      // Validate geographic and data requirements
      const isValidCoord = !isNaN(lat) && !isNaN(lng) && 
                           lat !== 0 && lng !== 0 && 
                           lat >= -90 && lat <= 90 && 
                           lng >= -180 && lng <= 180;

      const isValidCustomer = custName.length > 0;

      if (isValidCoord && isValidCustomer) {
        // Canonical customer key (combining same name across DBs and case variations)
        const canonicalKey = custName.toUpperCase();
        const color = colorManager.getColorForCustomer(canonicalKey);

        const outlet = {
          id: outletId++,
          distName: distName || 'Unknown District',
          custName: custName,
          canonicalCustName: canonicalKey,
          outletType: outletType || 'Standard',
          lat: lat,
          lng: lng,
          color: color
        };

        this.outlets.push(outlet);

        // Grouping customer across all DBs
        if (!this.customerMap.has(canonicalKey)) {
          this.customerMap.set(canonicalKey, []);
          this.customerDisplayNameMap.set(canonicalKey, custName);
        }
        this.customerMap.get(canonicalKey).push(outlet);

        if (!this.districtMap.has(distName)) {
          this.districtMap.set(distName, []);
        }
        this.districtMap.get(distName).push(outlet);

        if (!this.typeMap.has(outletType)) {
          this.typeMap.set(outletType, []);
        }
        this.typeMap.get(outletType).push(outlet);

        // Bounding box calculations
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);

        latSum += lat;
        lngSum += lng;
      } else {
        this.invalidRows.push({
          rowNumber: i + 1,
          data: row,
          reason: !isValidCustomer ? 'Missing CUST_NAME' : 'Invalid or zero coordinates'
        });
      }
    }

    const validCount = this.outlets.length;
    const invalidCount = this.invalidRows.length;
    const totalRows = parsedRows.length - 1;

    this.stats = {
      totalRows,
      validOutlets: validCount,
      invalidRecords: invalidCount,
      uniqueCustomersCount: this.customerMap.size,
      uniqueDistrictsCount: this.districtMap.size,
      uniqueTypesCount: this.typeMap.size,
      bounds: validCount > 0 ? [[minLat, minLng], [maxLat, maxLng]] : null,
      center: validCount > 0 ? [latSum / validCount, lngSum / validCount] : [28.4595, 77.0266]
    };

    console.info(`[DataLoader] Loaded ${totalRows} records. Valid outlets: ${validCount}, Skipped: ${invalidCount}. Combined unique customers: ${this.customerMap.size}`);

    return {
      outlets: this.outlets,
      stats: this.stats,
      customerMap: this.customerMap,
      districtMap: this.districtMap,
      typeMap: this.typeMap,
      invalidRows: this.invalidRows
    };
  }

  /**
   * Get outlets for a specific customer (case-insensitive lookup across DBs)
   * @param {string} customerName 
   * @returns {Array<object>}
   */
  getOutletsByCustomer(customerName) {
    if (!customerName) return [];
    const key = customerName.trim().toUpperCase();
    return this.customerMap.get(key) || [];
  }

  /**
   * Get all customers sorted by number of outlets descending or alphabetically,
   * combining all DBs for the customer and listing their associated districts.
   * @param {string} sortBy 'count' | 'name'
   * @returns {Array<object>} [{ name, displayName, count, color, districts, districtsFormatted, outlets }]
   */
  getCustomersSummary(sortBy = 'count') {
    const summary = [];
    for (const [canonicalKey, outlets] of this.customerMap.entries()) {
      const displayName = this.customerDisplayNameMap.get(canonicalKey) || canonicalKey;
      const districtSet = new Set(outlets.map(o => o.distName));
      const districts = Array.from(districtSet).sort();

      summary.push({
        name: canonicalKey,
        displayName: displayName,
        count: outlets.length,
        color: colorManager.getColorForCustomer(canonicalKey),
        districts: districts,
        districtsFormatted: districts.join(', '),
        outlets: outlets
      });
    }

    if (sortBy === 'count') {
      summary.sort((a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName));
    } else {
      summary.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    return summary;
  }
}

export const dataLoader = new DataLoader();

