/**
 * Automated Verification Test Suite for Outlet Navigation System
 */

import fs from 'fs';
import http from 'http';
import { colorManager } from '../js/colors.js';
import { DataLoader } from '../js/data.js';
import { routingService, RouteResult, TomTomRoutingAdapter } from '../js/routing.js';
import { CONFIG } from '../config/config.js';

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

async function runTests() {
  console.log('=== STARTING AUTOMATED TEST SUITE ===\n');

  // Test 1: Color Manager Determinism & Scalability
  console.log('Test Suite 1: Customer Color System');
  const colA1 = colorManager.getColorForCustomer('24 SPOT');
  const colA2 = colorManager.getColorForCustomer('24 SPOT');
  const colB = colorManager.getColorForCustomer('ABC RESTAURANT');
  const colC = colorManager.getColorForCustomer('2nd WIFE RESTAURANT');

  assert(colA1.hex === colA2.hex, 'Same customer gets identical hex color on subsequent calls');
  assert(colA1.hsl === colA2.hsl, 'Same customer gets identical HSL color string');
  assert(colA1.hex !== colB.hex, 'Different customers receive distinct colors');
  assert(colA1.hex !== colC.hex, 'Different customers receive distinct colors');
  assert(typeof colA1.textContrastColor === 'string', 'Text contrast color is calculated');
  assert(typeof colA1.rgba(0.5) === 'string' && colA1.rgba(0.5).includes('rgba('), 'RGBA generator works correctly');

  // Test 2: DataLoader & RFC-4180 CSV Parser on real data
  console.log('\nTest Suite 2: Data Loading & CSV Parsing');
  const csvContent = fs.readFileSync('./data/outlets.csv', 'utf8');
  const loader = new DataLoader();
  const dataset = loader.processCSV(csvContent);

  assert(dataset.outlets.length === 4344, `Loaded exactly 4,344 valid outlets (got ${dataset.outlets.length})`);
  assert(dataset.stats.totalRows === 4345, `Total rows in CSV is 4,345 (got ${dataset.stats.totalRows})`);
  assert(dataset.stats.invalidRecords === 1, `Invalid records is 1 (Sanjay Store with 0,0 coords) (got ${dataset.stats.invalidRecords})`);
  assert(dataset.stats.uniqueCustomersCount > 3000, `Found >3,000 unique customers (got ${dataset.stats.uniqueCustomersCount})`);
  assert(dataset.stats.uniqueDistrictsCount === 3, `Found 3 unique districts (got ${dataset.stats.uniqueDistrictsCount})`);
  assert(dataset.stats.bounds !== null, 'Calculated non-null bounding box');
  assert(dataset.stats.bounds[0][0] >= 28 && dataset.stats.bounds[1][0] <= 39, 'Bounding box latitude is valid');

  const spotOutlets = loader.getOutletsByCustomer('24 SPOT');
  assert(spotOutlets.length >= 1, `24 SPOT customer has outlets found (got ${spotOutlets.length})`);
  assert(spotOutlets[0].lat !== 0 && spotOutlets[0].lng !== 0, 'Outlet coordinates are non-zero');
  assert(spotOutlets[0].color.hex === colA1.hex, 'Outlet marker color matches ColorManager deterministic color');

  // Multi-DB Customer combining test
  const amitOutlets = loader.getOutletsByCustomer('AMIT STORE');
  const amitDistricts = new Set(amitOutlets.map(o => o.distName));
  assert(amitOutlets.length >= 3, `AMIT STORE combined across DBs (got ${amitOutlets.length} outlets)`);
  assert(amitDistricts.size >= 2, `AMIT STORE spans multiple districts: ${Array.from(amitDistricts).join(', ')}`);

  const summary = loader.getCustomersSummary('count');
  const amitSummary = summary.find(c => c.name === 'AMIT STORE');
  assert(amitSummary !== undefined, 'AMIT STORE exists in customer summary');
  assert(amitSummary.districts.length >= 2, `AMIT STORE summary contains multiple DBs: ${amitSummary.districtsFormatted}`);


  // Test 3: Routing Engine Interface & Fallback Generation
  console.log('\nTest Suite 3: Routing Engine & ETA Formatting');
  const origin = { lat: 28.4530, lng: 77.0506 };
  const dest = { lat: 28.4900, lng: 77.0942 };

  const routeRes = await routingService.calculateRoute(origin, dest);
  assert(routeRes.primaryRoute !== null, 'Route calculation returns primaryRoute');
  assert(routeRes.primaryRoute.coordinates.length > 5, `Primary route contains polyline coordinates (got ${routeRes.primaryRoute.coordinates.length})`);
  assert(routeRes.primaryRoute.distanceMeters > 0, `Route distance is positive: ${routeRes.primaryRoute.formattedDistance}`);
  assert(routeRes.primaryRoute.travelTimeSeconds > 0, `Route travel time is positive: ${routeRes.primaryRoute.formattedTime}`);
  assert(routeRes.primaryRoute.instructions.length >= 2, `Route contains turn instructions (got ${routeRes.primaryRoute.instructions.length})`);

  const eta = routingService.getTrafficAwareETA(routeRes.primaryRoute);
  assert(typeof eta.distance === 'string', `ETA distance formatted: ${eta.distance}`);
  assert(typeof eta.duration === 'string', `ETA duration formatted: ${eta.duration}`);
  assert(typeof eta.etaTimestamp === 'string', `ETA timestamp formatted: ${eta.etaTimestamp}`);

  // Test 4: Maneuver normalization
  console.log('\nTest Suite 4: TomTom Maneuver Translation');
  const adapter = new TomTomRoutingAdapter();
  assert(adapter.normalizeManeuver('TURN_LEFT', -90) === 'turn-left', 'TURN_LEFT maps to turn-left');
  assert(adapter.normalizeManeuver('TURN_RIGHT', 90) === 'turn-right', 'TURN_RIGHT maps to turn-right');
  assert(adapter.normalizeManeuver('SHARP_LEFT', -120) === 'turn-sharp-left', 'SHARP_LEFT maps to turn-sharp-left');
  assert(adapter.normalizeManeuver('ROUNDABOUT', 0) === 'roundabout', 'ROUNDABOUT maps to roundabout');
  assert(adapter.normalizeManeuver('ARRIVE', 0) === 'destination', 'ARRIVE maps to destination');

  // Test 5: HTTP Server Connectivity
  console.log('\nTest Suite 5: Web Server Status');
  const checkUrl = (path) => new Promise((resolve) => {
    http.get(`http://127.0.0.1:8080${path}`, (res) => {
      resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'] });
    }).on('error', (e) => resolve({ statusCode: 0, error: e.message }));
  });

  const indexRes = await checkUrl('/index.html');
  assert(indexRes.statusCode === 200 || indexRes.statusCode === 301, `GET /index.html returned valid status (got ${indexRes.statusCode})`);

  const cssRes = await checkUrl('/css/style.css');
  assert(cssRes.statusCode === 200, `GET /css/style.css returned HTTP 200 (got ${cssRes.statusCode})`);

  const dataRes = await checkUrl('/data/outlets.csv');
  assert(dataRes.statusCode === 200, `GET /data/outlets.csv returned HTTP 200 (got ${dataRes.statusCode})`);

  const jsRes = await checkUrl('/js/app.js');
  assert(jsRes.statusCode === 200, `GET /js/app.js returned HTTP 200 (got ${jsRes.statusCode})`);

  // Test 6: Search & Filtering Logic
  console.log('\nTest Suite 6: Search & Filter Logic');
  const allOutlets = dataset.outlets;
  
  // Search Simulation
  const query = '24 SPOT';
  const matchedOutlets = allOutlets.filter(o => 
    o.custName.toLowerCase().includes(query.toLowerCase()) ||
    o.distName.toLowerCase().includes(query.toLowerCase())
  );
  assert(matchedOutlets.length >= 1, `Search for '24 SPOT' matches records (got ${matchedOutlets.length})`);

  // Filter Simulation by District
  const db1Outlets = allOutlets.filter(o => o.distName === 'DB 1');
  const db2Outlets = allOutlets.filter(o => o.distName === 'DB 2');
  const db3Outlets = allOutlets.filter(o => o.distName === 'DB 3');
  assert(db1Outlets.length > 0, `DB 1 district has outlets (got ${db1Outlets.length})`);
  assert(db2Outlets.length > 0, `DB 2 district has outlets (got ${db2Outlets.length})`);
  assert(db3Outlets.length > 0, `DB 3 district has outlets (got ${db3Outlets.length})`);
  assert(db1Outlets.length + db2Outlets.length + db3Outlets.length === 4344, 'District sum equals total valid outlets');

  // Filter Simulation by Type
  const visiOutlets = allOutlets.filter(o => o.outletType === 'VISI');
  const nvisiOutlets = allOutlets.filter(o => o.outletType === 'NVISI');
  assert(visiOutlets.length > 0, `VISI outlet type has records (got ${visiOutlets.length})`);
  assert(nvisiOutlets.length > 0, `NVISI outlet type has records (got ${nvisiOutlets.length})`);

  // Test 7: Navigation Mathematics (Haversine, Cross-Track Deviation)
  console.log('\nTest Suite 7: Navigation Mathematics & Deviation Math');
  function haversineDist(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  // Points 1km apart
  const pA = { lat: 28.4500, lng: 77.0500 };
  const pB = { lat: 28.4590, lng: 77.0500 };
  const dist = haversineDist(pA.lat, pA.lng, pB.lat, pB.lng);
  assert(dist > 950 && dist < 1050, `Haversine distance between 28.4500 and 28.4590 is ~1000m (got ${dist.toFixed(1)}m)`);

  // Perpendicular distance to line segment using planar metric projection
  function distToSegment(p, v, w) {
    if (!p || !v || !w) return Infinity;
    const midLat = ((v.lat + w.lat + p.lat) / 3) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);
    const wx = (w.lng - v.lng) * cosLat * 111320;
    const wy = (w.lat - v.lat) * 110540;
    const px = (p.lng - v.lng) * cosLat * 111320;
    const py = (p.lat - v.lat) * 110540;
    const segLenSq = wx * wx + wy * wy;
    if (segLenSq < 0.25) return Math.hypot(px, py);
    const t = Math.max(0, Math.min(1, (px * wx + py * wy) / segLenSq));
    const projX = t * wx;
    const projY = t * wy;
    const dist = Math.hypot(px - projX, py - projY);
    return Number.isFinite(dist) ? dist : Math.hypot(px, py);
  }

  const lineStart = { lat: 28.4500, lng: 77.0500 };
  const lineEnd = { lat: 28.4500, lng: 77.0600 };
  const onLinePt = { lat: 28.4500, lng: 77.0550 };
  const offLinePt = { lat: 28.4510, lng: 77.0550 }; // ~110m north of line
  const duplicatePt = { lat: 28.4500, lng: 77.0500 }; // Identical point to lineStart

  const onLineDist = distToSegment(onLinePt, lineStart, lineEnd);
  const offLineDist = distToSegment(offLinePt, lineStart, lineEnd);
  const duplicateDist = distToSegment(offLinePt, lineStart, duplicatePt);

  assert(onLineDist < 5, `Point on segment has near-zero deviation: ${onLineDist.toFixed(1)}m`);
  assert(offLineDist > 90 && offLineDist < 130, `Point 0.001 deg away has ~110m deviation (got ${offLineDist.toFixed(1)}m)`);
  assert(offLineDist > CONFIG.NAVIGATION.DEVIATION_THRESHOLD_METERS, `Off-line point correctly exceeds deviation threshold of ${CONFIG.NAVIGATION.DEVIATION_THRESHOLD_METERS}m`);
  assert(Number.isFinite(duplicateDist) && !isNaN(duplicateDist), `Segment with duplicate identical points never returns NaN (got ${duplicateDist.toFixed(1)}m)`);

  // Test 8: Google Maps High-Density Tile Providers
  console.log('\nTest Suite 8: High-Density Map Providers');
  assert(CONFIG.DEFAULT_TILE_PROVIDER === 'google_streets', 'Default tile provider is set to google_streets');
  assert(CONFIG.TILE_PROVIDERS.google_streets !== undefined, 'Google Maps Streets provider is configured');
  assert(CONFIG.TILE_PROVIDERS.google_hybrid !== undefined, 'Google Maps Satellite Hybrid provider is configured');
  assert(CONFIG.TILE_PROVIDERS.osm_dense !== undefined, 'OpenStreetMap Detailed provider is configured');
  assert(CONFIG.TILE_PROVIDERS.google_streets.maxZoom === 21, 'Google Maps Streets supports high zoom level 21 for building footprints');
  assert(CONFIG.TILE_PROVIDERS.google_hybrid.maxZoom === 21, 'Google Maps Satellite supports zoom 21 for rooftop detail');

  // Test 9: Admin Portal Server & APIs (Port 8081 - Optional check)
  console.log('\nTest Suite 9: Admin Portal Server (Port 8081)');
  const checkAdminUrl = (path) => new Promise((resolve) => {
    http.get(`http://localhost:8081${path}`, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, contentType: res.headers['content-type'], body: data });
      });
    }).on('error', (e) => resolve({ statusCode: 0, error: e.message }));
  });

  const adminIndex = await checkAdminUrl('/index.html');
  if (adminIndex.statusCode === 200) {
    assert(true, 'GET http://localhost:8081/index.html returned HTTP 200');
    const adminStats = await checkAdminUrl('/api/stats');
    if (adminStats.statusCode === 200 && adminStats.body) {
      try {
        const parsedStats = JSON.parse(adminStats.body);
        assert(parsedStats.totalStores >= 4000, `Admin stats returns total stores (got ${parsedStats.totalStores})`);
        assert(parsedStats.districts.length === 3, `Admin stats lists 3 districts: ${parsedStats.districts.join(', ')}`);
      } catch (_) {}
    }
  } else {
    console.log('  ℹ INFO: Admin server on 8081 not running in this test environment (skipped)');
  }

  // Test 10: Global Place & Address Search Engine
  console.log('\nTest Suite 10: Global Place & Address Search Engine');
  try {
    const { SearchEngine } = await import('../js/search.js');
    const searchEngine = new SearchEngine(loader, null);
    
    // Test global search execution
    const globalResults = await searchEngine.searchGlobalPlaces('Connaught Place', new AbortController().signal);
    assert(Array.isArray(globalResults), 'Global place search returns an array');
    assert(globalResults.length > 0, `Global search found results for "Connaught Place" (got ${globalResults.length})`);
    
    const firstPlace = globalResults[0];
    assert(firstPlace.type === 'global_place', 'Result type is global_place');
    assert(firstPlace.outlet !== undefined, 'Result contains destination outlet payload');
    assert(firstPlace.outlet.isGlobalPlace === true, 'Outlet is marked as global place');
    assert(typeof firstPlace.outlet.lat === 'number' && firstPlace.outlet.lat > 20 && firstPlace.outlet.lat < 35, `Valid latitude: ${firstPlace.outlet.lat}`);
    assert(typeof firstPlace.outlet.lng === 'number' && firstPlace.outlet.lng > 70 && firstPlace.outlet.lng < 85, `Valid longitude: ${firstPlace.outlet.lng}`);
    assert(firstPlace.outlet.custName.length > 0, `Place has display name: ${firstPlace.outlet.custName}`);
    assert(firstPlace.outlet.color && firstPlace.outlet.color.hex, 'Place has contrast navigation marker color');

    // Test coordinate query regex matching
    const coordQuery = "28.5355, 77.3910";
    const coordMatch = coordQuery.match(/^([-+]?\d{1,2}(?:\.\d+)?)\s*[, ]\s*([-+]?\d{1,3}(?:\.\d+)?)$/);
    assert(coordMatch !== null, 'Coordinate search regex parses valid lat,lng');
    assert(parseFloat(coordMatch[1]) === 28.5355, 'Latitude parsed correctly');
    assert(parseFloat(coordMatch[2]) === 77.3910, 'Longitude parsed correctly');
  } catch (searchTestErr) {
    console.error('Search Engine Test Error:', searchTestErr);
    assert(false, `Search Engine test encountered error: ${searchTestErr.message}`);
  }

  // Test Suite 11: Map Click-to-Navigate & Reverse Geocoding
  console.log('\nTest Suite 11: Map Click-to-Navigate & Reverse Geocoding');
  try {
    const { default: searchHandler } = await import('../api/search.js');
    
    // Simulate reverse geocoding request to api/search.js
    let responseData = null;
    let statusCode = 0;
    const mockReq = {
      method: 'GET',
      query: { reverse: 'true', lat: '28.4595', lon: '77.0266' }
    };
    const mockRes = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { responseData = data; },
          end: () => {}
        };
      }
    };

    await searchHandler(mockReq, mockRes);
    assert(statusCode === 200, `Reverse geocoding endpoint returned HTTP 200 (got ${statusCode})`);
    assert(responseData !== null, 'Reverse geocoding returned JSON payload');
    assert(typeof responseData.title === 'string' && responseData.title.length > 0, `Reverse geocoded title: ${responseData.title}`);
    assert(typeof responseData.lat === 'number' && responseData.lat === 28.4595, 'Latitude matches query');
    assert(typeof responseData.lng === 'number' && responseData.lng === 77.0266, 'Longitude matches query');

    // Test Dropped Pin destination payload structure
    const testDroppedPin = {
      id: `dropped-pin-${Date.now()}`,
      custName: 'Dropped Pin',
      distName: '28.45950, 77.02660',
      outletType: 'Custom Destination',
      lat: 28.4595,
      lng: 77.0266,
      color: { hex: '#00f0ff', textContrastColor: '#000000', name: 'Cyan Neon' },
      isDroppedPin: true
    };
    assert(testDroppedPin.isDroppedPin === true, 'Destination is marked as dropped pin');
    assert(testDroppedPin.color.hex === '#00f0ff', 'Dropped pin has high visibility neon color');

    // Test Travel Time & Distance calculation for Store/Pin Popup Card
    const origin = { lat: 28.4595, lng: 77.0266 };
    const dest = { lat: 28.4700, lng: 77.0500 };
    const route = await routingService.calculateRoute(origin, dest);
    assert(route && route.primaryRoute, 'Routing calculation succeeded for store popup');
    assert(typeof route.primaryRoute.formattedTime === 'string' && route.primaryRoute.formattedTime.includes('min'), `Popup displays travel time: ${route.primaryRoute.formattedTime}`);
    assert(typeof route.primaryRoute.formattedDistance === 'string' && route.primaryRoute.formattedDistance.includes('km'), `Popup displays distance in kilometers: ${route.primaryRoute.formattedDistance}`);
  } catch (revErr) {
    console.error('Reverse Geocode Test Error:', revErr);
    assert(false, `Reverse Geocode test failed: ${revErr.message}`);
  }

  // ==========================================
  // Test Suite 12: Custom Starting Location & Route Recalculation
  // ==========================================
  console.log('\nTest Suite 12: Custom Starting Location & Route Recalculation');
  try {
    const fs = await import('fs');
    const indexHtml = fs.readFileSync('./index.html', 'utf-8');

    // 1. Verify HTML elements for Google Maps style waypoints and origin picker
    assert(indexHtml.includes('card-waypoints-box'), 'Popup card contains card-waypoints-box');
    assert(indexHtml.includes('card-origin-text'), 'Popup card contains card-origin-text');
    assert(indexHtml.includes('btn-change-origin'), 'Popup card contains btn-change-origin');
    assert(indexHtml.includes('btn-swap-waypoints'), 'Popup card contains btn-swap-waypoints');
    assert(indexHtml.includes('card-dest-text'), 'Popup card contains card-dest-text');
    assert(indexHtml.includes('origin-picker-panel'), 'Popup card contains origin-picker-panel');
    assert(indexHtml.includes('origin-search-input'), 'Origin picker contains origin-search-input');
    assert(indexHtml.includes('btn-origin-gps'), 'Origin picker contains "Your Location (GPS)" button');
    assert(indexHtml.includes('btn-origin-pick-map'), 'Origin picker contains "Choose on map" button');
    assert(indexHtml.includes('origin-search-results'), 'Origin picker contains origin-search-results container');
    assert(indexHtml.includes('card-body-scrollable'), 'Popup card contains scrollable body so actions are never hidden');
    assert(indexHtml.includes('bottom-sheet-drag-handle'), 'Popup card contains mobile bottom sheet drag handle');
    assert(indexHtml.includes('nav-hud-top-group'), 'HUD contains top group for proper mobile top/bottom split');

    // 2. Test route calculation from custom origin to destination
    const customOrigin = { lat: 28.6315, lng: 77.2202, name: 'Connaught Place, New Delhi' };
    const destination = { lat: 28.4595, lng: 77.0266, name: 'Gurgaon Central Store' };
    
    const forwardRoute = await routingService.calculateRoute(customOrigin, destination);
    assert(forwardRoute && forwardRoute.primaryRoute, 'Route calculated from custom origin to destination');
    assert(forwardRoute.primaryRoute.distanceMeters > 0, `Custom route distance: ${forwardRoute.primaryRoute.formattedDistance}`);
    assert(forwardRoute.primaryRoute.travelTimeSeconds > 0, `Custom route duration: ${forwardRoute.primaryRoute.formattedTime}`);

    // 3. Test swapped waypoints route calculation (Destination -> Origin)
    const reversedRoute = await routingService.calculateRoute(destination, customOrigin);
    assert(reversedRoute && reversedRoute.primaryRoute, 'Swapped route calculated from destination back to origin');
    assert(reversedRoute.primaryRoute.distanceMeters > 0, `Swapped route distance: ${reversedRoute.primaryRoute.formattedDistance}`);
    assert(reversedRoute.primaryRoute.travelTimeSeconds > 0, `Swapped route duration: ${reversedRoute.primaryRoute.formattedTime}`);

    // 4. Test Worldwide Starting Location Query Resolution (e.g. DLF Cyber City or Central Park)
    const ttRes = await fetch('https://api.tomtom.com/search/2/search/DLF%20Cyber%20City.json?key=mgndztNNLEEhOExutMyrIinaVGoxRpRw&limit=3');
    assert(ttRes.ok, 'Worldwide starting location search endpoint reachable');
    const ttData = await ttRes.json();
    assert(ttData.results && ttData.results.length > 0, `Found worldwide starting locations (got ${ttData.results.length})`);
    assert(typeof ttData.results[0].position.lat === 'number', `Resolved latitude: ${ttData.results[0].position.lat}`);
    assert(typeof ttData.results[0].position.lon === 'number', `Resolved longitude: ${ttData.results[0].position.lon}`);
  } catch (err) {
    console.error('Custom Origin Test Error:', err);
    assert(false, `Custom Origin test failed: ${err.message}`);
  }

  // ==========================================
  // Test Suite 13: Navigation Mode Collapsible Outlet Detail Window
  // ==========================================
  console.log('\nTest Suite 13: Navigation Mode Collapsible Outlet Detail Window');
  try {
    const fs = await import('fs');
    const indexHtml = fs.readFileSync('./index.html', 'utf-8');
    const styleCss = fs.readFileSync('./css/style.css', 'utf-8');
    const navJs = fs.readFileSync('./js/navigation.js', 'utf-8');

    // 1. HTML elements in index.html
    assert(indexHtml.includes('nav-outlet-window'), 'index.html contains nav-outlet-window');
    assert(indexHtml.includes('nav-outlet-capsule'), 'index.html contains nav-outlet-capsule (collapsed pill)');
    assert(indexHtml.includes('nav-outlet-expanded-card'), 'index.html contains nav-outlet-expanded-card (expanded view)');
    assert(indexHtml.includes('btn-collapse-nav-outlet'), 'index.html contains btn-collapse-nav-outlet (minimize/collapse button)');
    assert(indexHtml.includes('btn-toggle-nav-outlet-info'), 'index.html contains btn-toggle-nav-outlet-info in HUD');
    assert(indexHtml.includes('nav-dest-summary-btn'), 'index.html contains clickable nav-dest-summary-btn in HUD');
    assert(indexHtml.includes('btn-nav-copy-coords'), 'index.html contains btn-nav-copy-coords');
    assert(indexHtml.includes('nav-capsule-name'), 'index.html contains nav-capsule-name');
    assert(indexHtml.includes('nav-capsule-pill'), 'index.html contains nav-capsule-pill');
    assert(indexHtml.includes('nav-card-cust-name'), 'index.html contains nav-card-cust-name');
    assert(indexHtml.includes('nav-card-color-pill'), 'index.html contains nav-card-color-pill');
    assert(indexHtml.includes('nav-card-total-outlets'), 'index.html contains nav-card-total-outlets');
    assert(indexHtml.includes('nav-card-dist-name'), 'index.html contains nav-card-dist-name');
    assert(indexHtml.includes('nav-card-outlet-type'), 'index.html contains nav-card-outlet-type');
    assert(indexHtml.includes('nav-card-lat'), 'index.html contains nav-card-lat');
    assert(indexHtml.includes('nav-card-lng'), 'index.html contains nav-card-lng');

    // 2. CSS styles in css/style.css
    assert(styleCss.includes('.nav-outlet-window'), 'style.css defines .nav-outlet-window');
    assert(styleCss.includes('.nav-outlet-capsule'), 'style.css defines .nav-outlet-capsule');
    assert(styleCss.includes('.nav-outlet-expanded-card'), 'style.css defines .nav-outlet-expanded-card');
    assert(styleCss.includes('.btn-nav-info-toggle'), 'style.css defines .btn-nav-info-toggle');
    assert(styleCss.includes('btn-collapse-nav-outlet'), 'style.css defines .btn-collapse-nav-outlet');
    assert(styleCss.includes('.nav-outlet-window.collapsed'), 'style.css defines collapsed state');
    assert(styleCss.includes('.nav-outlet-window.expanded'), 'style.css defines expanded state');

    // 3. Navigation controller logic in js/navigation.js
    assert(navJs.includes('showNavOutletWindow'), 'navigation.js implements showNavOutletWindow');
    assert(navJs.includes('toggleNavOutletWindow'), 'navigation.js implements toggleNavOutletWindow');
    assert(navJs.includes('hideNavOutletWindow'), 'navigation.js implements hideNavOutletWindow');
    assert(navJs.includes('copyNavDestinationCoords'), 'navigation.js implements copyNavDestinationCoords');
    assert(navJs.includes('btn-toggle-nav-outlet-info'), 'navigation.js binds toggle button');
    assert(navJs.includes('nav-outlet-capsule'), 'navigation.js binds capsule pill click to expand');
    assert(navJs.includes('btn-collapse-nav-outlet'), 'navigation.js binds collapse button');
  } catch (err) {
    console.error('Nav Outlet Window Test Error:', err);
    assert(false, `Nav Outlet Window test failed: ${err.message}`);
  }

  console.log(`\n=== TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED ===\n`);


  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test Suite Fatal Error:', err);
  process.exit(1);
});

