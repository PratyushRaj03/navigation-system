/**
 * Security Utility Module
 * Input sanitization, coordinate bounds validation, and formula injection defenses.
 */

// Characters that can trigger formula execution in spreadsheet software
const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Neutralizes Formula Injection (CSV / Excel Injection - CWE-1236)
 * Prepend a single quote (') if the value begins with any trigger character.
 * @param {string} val 
 * @returns {string} Sanitized string
 */
export function sanitizeCsvCell(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);
  
  // If cell starts with formula trigger characters (including tab, carriage return, =, +, -, @), neutralize
  if (FORMULA_TRIGGER_CHARS.some(char => str.startsWith(char))) {
    str = `'${str}`;
  }
  
  // Strip dangerous ASCII control characters
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return str;
}

/**
 * Validates whether latitude and longitude are valid numbers within WGS84 bounds
 * - Latitude: -90.0 to +90.0
 * - Longitude: -180.0 to +180.0
 * Rejects NaN, Infinity, -Infinity, 0,0 (null island if excluded), and out-of-range values.
 * @param {number|string} lat 
 * @param {number|string} lng 
 * @param {boolean} allowZero Whether 0,0 is allowed
 * @returns {{ valid: boolean, lat?: number, lng?: number, reason?: string }}
 */
export function validateCoordinates(lat, lng, allowZero = false) {
  const parsedLat = typeof lat === 'number' ? lat : parseFloat(lat);
  const parsedLng = typeof lng === 'number' ? lng : parseFloat(lng);

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return { valid: false, reason: 'Coordinates must be valid numbers' };
  }

  if (!isFinite(parsedLat) || !isFinite(parsedLng)) {
    return { valid: false, reason: 'Coordinates must be finite numbers (rejects Infinity/NaN)' };
  }

  if (parsedLat < -90 || parsedLat > 90) {
    return { valid: false, reason: `Latitude ${parsedLat} is out of bounds (-90 to +90)` };
  }

  if (parsedLng < -180 || parsedLng > 180) {
    return { valid: false, reason: `Longitude ${parsedLng} is out of bounds (-180 to +180)` };
  }

  if (!allowZero && parsedLat === 0 && parsedLng === 0) {
    return { valid: false, reason: 'Coordinates (0,0) indicate uncalibrated GPS/null island' };
  }

  return { valid: true, lat: parsedLat, lng: parsedLng };
}

/**
 * Allowed vehicle travel modes
 */
export const ALLOWED_VEHICLE_TYPES = ['car', 'bike', 'truck', 'pedestrian', 'motorcycle'];

/**
 * Validates and normalizes vehicle travel mode
 * @param {string} mode 
 * @returns {string} Normalized vehicle mode
 */
export function validateVehicleType(mode) {
  if (!mode || typeof mode !== 'string') return 'car';
  const cleanMode = mode.toLowerCase().trim();
  if (ALLOWED_VEHICLE_TYPES.includes(cleanMode)) {
    return cleanMode;
  }
  // Mapping synonyms
  if (cleanMode === 'bicycle' || cleanMode === 'cycling') return 'bike';
  if (cleanMode === 'lorry' || cleanMode === 'heavy') return 'truck';
  if (cleanMode === 'walking' || cleanMode === 'walk') return 'pedestrian';
  return null;
}

/**
 * Cleans string inputs against XSS and control characters
 * @param {string} input 
 * @param {number} maxLength 
 * @returns {string}
 */
export function sanitizeString(input, maxLength = 255) {
  if (!input || typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}
