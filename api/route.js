/**
 * Secure Route Calculation API Endpoint (Vercel Serverless Function)
 * Encapsulates routing provider credentials server-side, validates coordinate bounds,
 * restricts vehicle modes, stops count and distance limits, and protects against SSRF.
 */

import { validateCoordinates, validateVehicleType } from './_security.js';
import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';
import { logSecurityEvent } from './_logger.js';

const ALLOWED_ROUTING_HOST = 'https://api.tomtom.com';
const MAX_STOPS = 25;
const MAX_DISTANCE_KM = 8000;

/**
 * Calculates approximate great-circle distance between two points in km
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(req, res) {
  if (handleCors(req, res, { methods: 'GET, POST, OPTIONS' })) {
    return;
  }

  // Rate Limiting: 60 route requests per minute per IP
  if (!checkRateLimit(req, res, { endpoint: 'route_calc', limit: 60, windowMs: 60 * 1000 })) {
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const params = req.method === 'POST' ? (req.body || {}) : req.query;
    const {
      originLat, originLng,
      destLat, destLng,
      vehicle = 'car',
      maxAlternatives = 2,
      traffic = 'true',
      stops = []
    } = params;

    // 1. Validate Origin Coordinates
    const originVal = validateCoordinates(originLat, originLng, false);
    if (!originVal.valid) {
      return res.status(400).json({ error: `Invalid origin coordinates: ${originVal.reason}` });
    }

    // 2. Validate Destination Coordinates
    const destVal = validateCoordinates(destLat, destLng, false);
    if (!destVal.valid) {
      return res.status(400).json({ error: `Invalid destination coordinates: ${destVal.reason}` });
    }

    // 3. Validate Vehicle Mode
    const validVehicle = validateVehicleType(vehicle);
    if (!validVehicle) {
      return res.status(400).json({
        error: `Invalid vehicle mode '${vehicle}'. Supported modes: car, bike, truck, pedestrian.`
      });
    }

    // Map internal vehicle modes to TomTom travelMode
    let travelMode = 'car';
    if (validVehicle === 'bike') travelMode = 'bicycle';
    else if (validVehicle === 'truck') travelMode = 'truck';
    else if (validVehicle === 'pedestrian') travelMode = 'pedestrian';
    else if (validVehicle === 'motorcycle') travelMode = 'motorcycle';

    // 4. Validate Intermediate Stops
    let parsedStops = [];
    if (Array.isArray(stops)) {
      if (stops.length > MAX_STOPS) {
        return res.status(400).json({ error: `Exceeded maximum allowed intermediate stops (${MAX_STOPS})` });
      }
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const sVal = validateCoordinates(s.lat || s[0], s.lng || s[1], false);
        if (!sVal.valid) {
          return res.status(400).json({ error: `Invalid stop #${i + 1} coordinates: ${sVal.reason}` });
        }
        parsedStops.push(`${sVal.lat},${sVal.lng}`);
      }
    }

    // 5. Check Reasonable Distance Limits
    const approxDistKm = haversineKm(originVal.lat, originVal.lng, destVal.lat, destVal.lng);
    if (approxDistKm > MAX_DISTANCE_KM) {
      return res.status(400).json({
        error: `Route distance (~${Math.round(approxDistKm)} km) exceeds maximum limit of ${MAX_DISTANCE_KM} km.`
      });
    }

    // 6. Build TomTom URL (Strict SSRF Prevention: strict static protocol + host)
    const pointsList = [
      `${originVal.lat},${originVal.lng}`,
      ...parsedStops,
      `${destVal.lat},${destVal.lng}`
    ].join(':');

    const TOMTOM_KEY = process.env.TOMTOM_API_KEY || 'mgndztNNLEEhOExutMyrIinaVGoxRpRw';
    const altCount = Math.min(Math.max(0, parseInt(maxAlternatives, 10) || 0), 3);

    const routingUrl = new URL(`${ALLOWED_ROUTING_HOST}/routing/1/calculateRoute/${pointsList}/json`);
    routingUrl.searchParams.append('key', TOMTOM_KEY);
    routingUrl.searchParams.append('traffic', traffic === 'false' ? 'false' : 'true');
    routingUrl.searchParams.append('travelMode', travelMode);
    routingUrl.searchParams.append('routeType', 'fastest');
    routingUrl.searchParams.append('computeTravelTimeFor', 'all');
    routingUrl.searchParams.append('instructionsType', 'text');
    routingUrl.searchParams.append('language', 'en-GB');
    routingUrl.searchParams.append('sectionType', 'traffic');
    if (altCount > 0 && travelMode !== 'pedestrian' && travelMode !== 'bicycle') {
      routingUrl.searchParams.append('maxAlternatives', altCount.toString());
    }

    // 7. Execute Upstream Request with Timeout
    const upstreamRes = await fetch(routingUrl.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });

    if (!upstreamRes.ok) {
      let upstreamErr = `Routing service responded with status ${upstreamRes.status}`;
      try {
        const errJson = await upstreamRes.json();
        upstreamErr = errJson.error?.description || errJson.detailedError?.message || upstreamErr;
      } catch (_) {}

      logSecurityEvent('ROUTE_UPSTREAM_ERROR', {
        req,
        status: 'ERROR',
        meta: { status: upstreamRes.status, vehicle: validVehicle }
      });

      return res.status(upstreamRes.status >= 500 ? 502 : upstreamRes.status).json({
        error: upstreamErr
      });
    }

    const data = await upstreamRes.json();
    return res.status(200).json(data);

  } catch (err) {
    logSecurityEvent('ROUTE_CALC_EXCEPTION', {
      req,
      status: 'ERROR',
      meta: { message: err.message }
    });
    return res.status(500).json({ error: 'Failed to calculate route. Please try again later.' });
  }
}
