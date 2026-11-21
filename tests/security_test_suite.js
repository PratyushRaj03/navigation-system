/**
 * Comprehensive Automated Security Verification Test Suite
 * Validates RBAC, token authentication, formula injection defenses,
 * coordinate bounds, vehicle mode restrictions, rate limiting, and security headers.
 */

import fs from 'fs';
import { authenticateCredentials, signToken, verifyToken, safeCompare, ROLES } from '../api/_auth.js';
import { sanitizeCsvCell, validateCoordinates, validateVehicleType, sanitizeString } from '../api/_security.js';
import { checkRateLimit } from '../api/_rate-limit.js';
import { isAllowedOrigin } from '../api/_cors.js';
import { redactSensitiveData } from '../api/_logger.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runSecurityTests() {
  console.log('=== STARTING SECURITY HARDENING TEST SUITE ===\n');

  // ==========================================
  // Suite 1: Authentication & Cryptographic Verification
  // ==========================================
  console.log('Test Suite 1: Authentication & Token Security');

  // 1.1 Credential verification
  const validAdminAuth = authenticateCredentials('admin', '2804');
  assert(validAdminAuth.authenticated === true, 'Admin credentials authenticate successfully');
  assert(validAdminAuth.role === ROLES.ADMIN, 'Admin receives admin role');

  const invalidAuth = authenticateCredentials('admin', 'wrong_password_999');
  assert(invalidAuth.authenticated === false, 'Invalid passkey is rejected');

  const safeCompareTiming = safeCompare('constant_time_test', 'constant_time_test');
  assert(safeCompareTiming === true, 'safeCompare returns true for identical strings');
  assert(safeCompare('a', 'b') === false, 'safeCompare returns false for distinct strings');

  // 1.2 Signed Token Lifecycle
  const token = signToken({ username: 'admin', role: ROLES.ADMIN }, 3600);
  assert(typeof token === 'string' && token.split('.').length === 3, 'Token generated in standard header.payload.signature format');

  const verified = verifyToken(token);
  assert(verified.valid === true, 'Legitimate signed token verifies successfully');
  assert(verified.payload.username === 'admin', 'Token payload contains expected username');
  assert(verified.payload.role === ROLES.ADMIN, 'Token payload contains expected role');

  // 1.3 Tampered Token Rejection
  const parts = token.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ username: 'hacker', role: 'superadmin' })).toString('base64url');
  const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
  const tamperedResult = verifyToken(tamperedToken);
  assert(tamperedResult.valid === false, 'Tampered token signature is rejected immediately');

  // 1.4 Expired Token Rejection
  const expiredToken = signToken({ username: 'admin', role: ROLES.ADMIN }, -10);
  const expiredResult = verifyToken(expiredToken);
  assert(expiredResult.valid === false && expiredResult.error.includes('expired'), 'Expired token is rejected');

  // ==========================================
  // Suite 2: CSV & Formula Injection Defenses (CWE-1236)
  // ==========================================
  console.log('\nTest Suite 2: Formula & CSV Injection Defense');

  const testFormulaEq = sanitizeCsvCell('=cmd|\' /C calc\'!A1');
  assert(testFormulaEq.startsWith("'="), 'Formula starting with = is neutralized with single quote prefix');

  const testFormulaPlus = sanitizeCsvCell('+1+2');
  assert(testFormulaPlus.startsWith("'+"), 'Formula starting with + is neutralized');

  const testFormulaMinus = sanitizeCsvCell('-2+3');
  assert(testFormulaMinus.startsWith("'-"), 'Formula starting with - is neutralized');

  const testFormulaAt = sanitizeCsvCell('@SUM(A1:A10)');
  assert(testFormulaAt.startsWith("'@"), 'Formula starting with @ is neutralized');

  const testFormulaTab = sanitizeCsvCell('\tmalicious');
  assert(testFormulaTab.startsWith("'\t"), 'Formula starting with tab is neutralized');

  const normalStore = sanitizeCsvCell('24 SPOT STORE');
  assert(normalStore === '24 SPOT STORE', 'Benign store name remains un-prefixed');

  // Control character stripping
  const controlChars = sanitizeCsvCell('Store\x00Name\x07WithBeep');
  assert(!controlChars.includes('\x00') && !controlChars.includes('\x07'), 'Dangerous control characters stripped');

  // ==========================================
  // Suite 3: Geospatial Coordinate Bounds Validation
  // ==========================================
  console.log('\nTest Suite 3: Geospatial Coordinate Validation');

  const validDelhi = validateCoordinates(28.4530, 77.0506);
  assert(validDelhi.valid === true, 'Delhi coordinates (28.4530, 77.0506) are valid');

  const outOfBoundsLat = validateCoordinates(95.0, 77.0);
  assert(outOfBoundsLat.valid === false, 'Latitude > 90 is rejected');

  const negativeOutOfBoundsLat = validateCoordinates(-91.0, 77.0);
  assert(negativeOutOfBoundsLat.valid === false, 'Latitude < -90 is rejected');

  const outOfBoundsLng = validateCoordinates(28.0, 185.0);
  assert(outOfBoundsLng.valid === false, 'Longitude > 180 is rejected');

  const negativeOutOfBoundsLng = validateCoordinates(28.0, -181.0);
  assert(negativeOutOfBoundsLng.valid === false, 'Longitude < -180 is rejected');

  const nanCoord = validateCoordinates('not_a_number', 77.0);
  assert(nanCoord.valid === false, 'NaN coordinate is rejected');

  const infinityCoord = validateCoordinates(Infinity, 77.0);
  assert(infinityCoord.valid === false, 'Infinity coordinate is rejected');

  const nullIsland = validateCoordinates(0, 0, false);
  assert(nullIsland.valid === false, 'Null Island (0,0) uncalibrated GPS rejected when allowZero=false');

  const nullIslandAllowed = validateCoordinates(0, 0, true);
  assert(nullIslandAllowed.valid === true, 'Null Island accepted when allowZero=true');

  // ==========================================
  // Suite 4: Vehicle Mode & Route Validation
  // ==========================================
  console.log('\nTest Suite 4: Vehicle Mode & Routing Security');

  assert(validateVehicleType('car') === 'car', 'Car vehicle type is valid');
  assert(validateVehicleType('bike') === 'bike', 'Bike vehicle type is valid');
  assert(validateVehicleType('bicycle') === 'bike', 'Bicycle maps to bike');
  assert(validateVehicleType('truck') === 'truck', 'Truck vehicle type is valid');
  assert(validateVehicleType('pedestrian') === 'pedestrian', 'Pedestrian vehicle type is valid');
  assert(validateVehicleType('submarine') === null, 'Unexpected vehicle type (submarine) rejected');
  assert(validateVehicleType('rocket') === null, 'Unexpected vehicle type (rocket) rejected');

  // ==========================================
  // Suite 5: Rate Limiting & Abuse Prevention
  // ==========================================
  console.log('\nTest Suite 5: Rate Limiting Subsystem');

  const mockReq = {
    headers: { 'x-forwarded-for': '203.0.113.42' },
    socket: { remoteAddress: '203.0.113.42' }
  };

  const headerCapture = {};
  let statusCode = 200;
  let jsonBody = null;

  const mockRes = {
    setHeader: (k, v) => { headerCapture[k] = v; },
    status: (code) => {
      statusCode = code;
      return {
        json: (b) => { jsonBody = b; }
      };
    }
  };

  // Run up to limit
  let allowedCount = 0;
  for (let i = 0; i < 5; i++) {
    const ok = checkRateLimit(mockReq, mockRes, { endpoint: 'test_ep', limit: 5, windowMs: 10000 });
    if (ok) allowedCount++;
  }
  assert(allowedCount === 5, 'Requests within threshold (5) are permitted');

  // 6th request triggers rate limit
  const sixthRequest = checkRateLimit(mockReq, mockRes, { endpoint: 'test_ep', limit: 5, windowMs: 10000 });
  assert(sixthRequest === false, 'Excess request beyond limit (6th) is rejected with 429');
  assert(statusCode === 429, 'Response status code is HTTP 429');
  assert(headerCapture['Retry-After'] !== undefined, 'Retry-After header returned');
  assert(headerCapture['X-RateLimit-Limit'] === 5, 'X-RateLimit-Limit header returned');

  // ==========================================
  // Suite 6: CORS & Origin Security
  // ==========================================
  console.log('\nTest Suite 6: CORS Origin Validation');

  assert(isAllowedOrigin('https://navigation-system3.vercel.app') === true, 'Production domain is allowed');
  assert(isAllowedOrigin('http://localhost:8080') === true, 'Local development is allowed');
  assert(isAllowedOrigin('http://127.0.0.1:8080') === true, '127.0.0.1 is allowed');
  assert(isAllowedOrigin('https://malicious-phishing-site.com') === false, 'Untrusted third-party domain is blocked');
  assert(isAllowedOrigin('https://evil-attacker.org') === false, 'Attacker origin blocked');

  // ==========================================
  // Suite 7: Sensitive Data Redaction
  // ==========================================
  console.log('\nTest Suite 7: Audit Logging & Sensitive Data Redaction');

  const unredacted = {
    user: 'admin',
    passkey: 'secret_pin_2804',
    apiKey: 'mgndztNNLEEhOExutMyrIinaVGoxRpRw',
    nested: {
      password: 'mypassword',
      action: 'store_add'
    }
  };

  const redacted = redactSensitiveData(unredacted);
  assert(redacted.user === 'admin', 'Non-sensitive field preserved');
  assert(redacted.passkey === '[REDACTED]', 'passkey field is redacted');
  assert(redacted.apiKey === '[REDACTED]', 'apiKey field is redacted');
  assert(redacted.nested.password === '[REDACTED]', 'Nested password field is redacted');
  assert(redacted.nested.action === 'store_add', 'Nested benign field preserved');

  // ==========================================
  // Suite 8: Vercel Production Security Headers
  // ==========================================
  console.log('\nTest Suite 8: Vercel Production Security Headers');

  const vercelJson = JSON.parse(fs.readFileSync('./vercel.json', 'utf8'));
  assert(Array.isArray(vercelJson.headers), 'vercel.json defines security headers array');

  const globalHeaders = vercelJson.headers.find(h => h.source === '/(.*)');
  assert(globalHeaders !== undefined, 'Global header rule (/(.*)) is present');

  const headerMap = {};
  for (const h of globalHeaders.headers) {
    headerMap[h.key.toLowerCase()] = h.value;
  }

  assert(headerMap['content-security-policy'] !== undefined, 'Content-Security-Policy configured');
  assert(headerMap['content-security-policy'].includes("frame-ancestors 'none'"), 'CSP frame-ancestors none prevents clickjacking');
  assert(headerMap['strict-transport-security'] !== undefined, 'HSTS (Strict-Transport-Security) configured');
  assert(headerMap['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options: nosniff configured');
  assert(headerMap['x-frame-options'] === 'DENY', 'X-Frame-Options: DENY configured');
  assert(headerMap['referrer-policy'] === 'strict-origin-when-cross-origin', 'Referrer-Policy configured');

  console.log(`\n=== SECURITY TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch(err => {
  console.error('Security Suite Fatal Error:', err);
  process.exit(1);
});
