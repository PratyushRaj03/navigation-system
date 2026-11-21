/**
 * Hardened Universal Global Search API Endpoint (Vercel Serverless Function)
 * Enables worldwide search for any place, apartment, park, landmark, or address
 * Combining TomTom Global Search, Photon Geocoder & OpenStreetMap Nominatim.
 * Hardened with Rate Limiting, Coordinate Validation, and Input Sanitization.
 */

import { checkRateLimit } from './_rate-limit.js';
import { handleCors } from './_cors.js';
import { validateCoordinates, sanitizeString } from './_security.js';
import { logSecurityEvent } from './_logger.js';

export default async function handler(req, res) {
  if (handleCors(req, res, { methods: 'GET, OPTIONS' })) {
    return;
  }

  // Rate Limiting: 120 searches per minute per IP
  if (!checkRateLimit(req, res, { endpoint: 'search', limit: 120, windowMs: 60 * 1000 })) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q, lat, lon, reverse } = req.query;

  // Reverse Geocoding Mode: Convert lat, lon to real road name & address
  if (reverse === 'true' && lat !== undefined && lon !== undefined) {
    const coordVal = validateCoordinates(lat, lon, true);
    if (!coordVal.valid) {
      return res.status(400).json({ error: `Invalid coordinates for reverse geocoding: ${coordVal.reason}` });
    }

    const TOMTOM_KEY = process.env.TOMTOM_API_KEY || 'mgndztNNLEEhOExutMyrIinaVGoxRpRw';

    // 1. Try TomTom Reverse Geocoding
    try {
      const ttRes = await fetch(`https://api.tomtom.com/search/2/reverseGeocode/${encodeURIComponent(coordVal.lat)},${encodeURIComponent(coordVal.lng)}.json?key=${TOMTOM_KEY}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (ttRes.ok) {
        const ttData = await ttRes.json();
        if (ttData.addresses && ttData.addresses.length > 0) {
          const a = ttData.addresses[0].address;
          const title = a.streetName || a.street || a.freeformAddress || a.municipalitySubdivision || 'Dropped Pin';
          const subParts = [a.municipalitySubdivision, a.municipality, a.countrySubdivision].filter(Boolean);
          return res.status(200).json({
            title: title,
            subtitle: subParts.join(', ') || a.freeformAddress,
            fullAddress: a.freeformAddress,
            lat: coordVal.lat,
            lng: coordVal.lng
          });
        }
      }
    } catch (_) {
      // Fall through to Photon fallback
    }

    // 2. Try Photon Fallback
    try {
      const pRes = await fetch(`https://photon.komoot.io/reverse?lat=${encodeURIComponent(coordVal.lat)}&lon=${encodeURIComponent(coordVal.lng)}`, {
        signal: AbortSignal.timeout(3000)
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        if (pData.features && pData.features.length > 0) {
          const props = pData.features[0].properties;
          const title = props.name || props.street || props.district || props.city || 'Dropped Pin';
          const subtitle = [props.street, props.district, props.city, props.state].filter(Boolean).join(', ');
          return res.status(200).json({
            title,
            subtitle,
            fullAddress: subtitle,
            lat: coordVal.lat,
            lng: coordVal.lng
          });
        }
      }
    } catch (_) {
      // Ignore
    }

    return res.status(200).json({
      title: 'Dropped Pin',
      subtitle: `${coordVal.lat}, ${coordVal.lng}`,
      fullAddress: `${coordVal.lat}, ${coordVal.lng}`,
      lat: coordVal.lat,
      lng: coordVal.lng
    });
  }

  // Forward Place / Address Search Mode
  const cleanQuery = sanitizeString(q, 100);
  if (!cleanQuery || cleanQuery.length < 2) {
    return res.status(200).json({ results: [] });
  }

  let focusLat = null;
  let focusLon = null;
  if (lat !== undefined && lon !== undefined) {
    const val = validateCoordinates(lat, lon, true);
    if (val.valid) {
      focusLat = val.lat;
      focusLon = val.lng;
    }
  }

  const TOMTOM_KEY = process.env.TOMTOM_API_KEY || 'mgndztNNLEEhOExutMyrIinaVGoxRpRw';

  // Run TomTom, Photon, and Nominatim concurrently
  const [ttResult, photonResult, nomResult] = await Promise.allSettled([
    // 1. TomTom Search API
    (async () => {
      let url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(cleanQuery)}.json?key=${TOMTOM_KEY}&typeahead=true&limit=8&language=en-US`;
      if (focusLat !== null && focusLon !== null) {
        url += `&lat=${encodeURIComponent(focusLat)}&lon=${encodeURIComponent(focusLon)}&radius=100000`;
      }
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (!d.results) return [];

      return d.results.map(item => {
        const pos = item.position;
        if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') return null;
        const title = item.poi?.name || item.address?.freeformAddress || cleanQuery;
        const subtitleParts = [];
        if (item.poi?.name && item.address?.freeformAddress) {
          subtitleParts.push(item.address.freeformAddress);
        } else {
          if (item.address?.streetNumber || item.address?.streetName) {
            subtitleParts.push([item.address.streetNumber, item.address.streetName].filter(Boolean).join(' '));
          }
          if (item.address?.municipalitySubdivision) subtitleParts.push(item.address.municipalitySubdivision);
          if (item.address?.municipality) subtitleParts.push(item.address.municipality);
          if (item.address?.countrySubdivision) subtitleParts.push(item.address.countrySubdivision);
          if (item.address?.country) subtitleParts.push(item.address.country);
        }
        return {
          id: `tt-${item.id || Math.random().toString(36).substr(2, 9)}`,
          title: title,
          subtitle: subtitleParts.filter(Boolean).join(', ') || 'Worldwide Location',
          type: item.poi?.classifications?.[0]?.code || 'Place / Landmark',
          lat: pos.lat,
          lng: pos.lon,
          source: 'tomtom'
        };
      }).filter(Boolean);
    })(),

    // 2. Photon Geocoder (OSM-based)
    (async () => {
      let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQuery)}&limit=8`;
      if (focusLat !== null && focusLon !== null) {
        url += `&lat=${encodeURIComponent(focusLat)}&lon=${encodeURIComponent(focusLon)}`;
      }
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (!d.features) return [];

      return d.features.map(f => {
        const coords = f.geometry?.coordinates;
        if (!coords || coords.length < 2) return null;
        const props = f.properties || {};
        const title = props.name || props.street || cleanQuery;
        const subParts = [props.street, props.district, props.city, props.state, props.country].filter(Boolean);
        return {
          id: `pho-${props.osm_id || Math.random().toString(36).substr(2, 9)}`,
          title: title,
          subtitle: subParts.join(', ') || 'Worldwide Location',
          type: props.type || props.osm_value || 'Address / Landmark',
          lat: coords[1],
          lng: coords[0],
          source: 'photon'
        };
      }).filter(Boolean);
    })(),

    // 3. Nominatim
    (async () => {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanQuery)}&format=json&limit=6&addressdetails=1`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'FleetNav-GlobalSearch/2.0' },
        signal: AbortSignal.timeout(2800)
      });
      if (!r.ok) return [];
      const d = await r.json();
      if (!Array.isArray(d)) return [];

      return d.map(item => {
        const latNum = parseFloat(item.lat);
        const lngNum = parseFloat(item.lon);
        if (isNaN(latNum) || isNaN(lngNum)) return null;
        const name = item.name || item.display_name.split(',')[0] || cleanQuery;
        return {
          id: `nom-${item.osm_id || Math.random().toString(36).substr(2, 9)}`,
          title: name,
          subtitle: item.display_name,
          type: item.type || item.class || 'Place / Address',
          lat: latNum,
          lng: lngNum,
          source: 'nominatim'
        };
      }).filter(Boolean);
    })()
  ]);

  const ttList = ttResult.status === 'fulfilled' ? ttResult.value : [];
  const photonList = photonResult.status === 'fulfilled' ? photonResult.value : [];
  const nomList = nomResult.status === 'fulfilled' ? nomResult.value : [];

  const merged = [];
  const addItems = (list) => {
    for (const item of list) {
      if (!item) continue;
      const isDuplicate = merged.some(m => {
        const distLat = Math.abs(m.lat - item.lat);
        const distLng = Math.abs(m.lng - item.lng);
        const sameCoords = distLat < 0.0015 && distLng < 0.0015;
        const sameTitle = m.title.toLowerCase() === item.title.toLowerCase() && distLat < 0.02;
        return sameCoords || sameTitle;
      });

      if (!isDuplicate) {
        merged.push(item);
      }
      if (merged.length >= 15) break;
    }
  };

  addItems(ttList);
  addItems(photonList);
  addItems(nomList);

  return res.status(200).json({ results: merged.slice(0, 12) });
}
