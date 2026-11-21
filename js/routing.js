/**
 * Modular Routing Service (Hardened)
 * Provides a unified routing interface supporting secure serverless proxy (/api/route)
 * and TomTom Traffic-Aware Routing API v1 with automatic fallback, coordinate bounds validation,
 * vehicle type support (car, bike, truck, pedestrian), and alternative route management.
 */

import { CONFIG } from '../config/config.js';

/**
 * Standardized Route Model returned by any routing adapter
 */
export class RouteResult {
  constructor({
    id = 'route-0',
    name = 'Recommended Route',
    isPrimary = true,
    distanceMeters = 0,
    travelTimeSeconds = 0,
    noTrafficTravelTimeSeconds = 0,
    trafficDelaySeconds = 0,
    coordinates = [], // Array of [lat, lng]
    instructions = [], // Array of Instruction objects
    trafficAware = true,
    provider = 'TomTom',
    vehicle = 'car',
    departureTime = null,
    arrivalTime = null,
    sections = []
  }) {
    this.id = id;
    this.name = name;
    this.isPrimary = isPrimary;
    this.distanceMeters = distanceMeters;
    this.travelTimeSeconds = travelTimeSeconds;
    this.noTrafficTravelTimeSeconds = noTrafficTravelTimeSeconds || travelTimeSeconds;
    this.trafficDelaySeconds = Math.max(0, trafficDelaySeconds);
    this.coordinates = coordinates;
    this.instructions = instructions;
    this.trafficAware = trafficAware;
    this.provider = provider;
    this.vehicle = vehicle;
    this.departureTime = departureTime || new Date();
    this.arrivalTime = arrivalTime || new Date(Date.now() + travelTimeSeconds * 1000);
    this.sections = sections;
  }

  get formattedDistance() {
    if (this.distanceMeters >= 1000) {
      return `${(this.distanceMeters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(this.distanceMeters)} m`;
  }

  get formattedTime() {
    const mins = Math.round(this.travelTimeSeconds / 60);
    if (mins < 60) {
      return `${Math.max(1, mins)} min`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hours} hr ${remMins > 0 ? remMins + ' min' : ''}`.trim();
  }

  get formattedNormalTime() {
    const mins = Math.round(this.noTrafficTravelTimeSeconds / 60);
    return `${Math.max(1, mins)} min`;
  }

  get formattedTrafficDelay() {
    if (this.trafficDelaySeconds <= 60) {
      return 'No delays';
    }
    const mins = Math.round(this.trafficDelaySeconds / 60);
    return `+${mins} min traffic delay`;
  }

  get formattedETA() {
    const d = new Date(this.arrivalTime);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

/**
 * Base Routing Provider Interface
 */
export class BaseRoutingProvider {
  async calculateRoute(origin, destination, options = {}) {
    throw new Error('calculateRoute() must be implemented by the routing provider');
  }
}

/**
 * Validates coordinate pair
 */
function isValidCoord(coord) {
  if (!coord || typeof coord !== 'object') return false;
  const lat = typeof coord.lat === 'number' ? coord.lat : parseFloat(coord.lat);
  const lng = typeof coord.lng === 'number' ? coord.lng : parseFloat(coord.lng);
  return !isNaN(lat) && !isNaN(lng) && isFinite(lat) && isFinite(lng) &&
         lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Official TomTom Routing API v1 Adapter with Serverless Proxy & Defense-in-Depth
 */
export class TomTomRoutingAdapter extends BaseRoutingProvider {
  constructor() {
    super();
    this.name = 'TomTom';
  }

  /**
   * Request routes with coordinate validation & vehicle modes
   * @param {object} origin { lat, lng }
   * @param {object} destination { lat, lng }
   * @param {object} options { vehicle, maxAlternatives, stops }
   * @returns {Promise<{ primaryRoute: RouteResult, alternativeRoutes: RouteResult[], allRoutes: RouteResult[] }>}
   */
  async calculateRoute(origin, destination, options = {}) {
    // 1. Client-Side Coordinate Validation
    if (!isValidCoord(origin)) {
      throw new Error('Invalid origin coordinates: latitude must be -90..90 and longitude -180..180');
    }
    if (!isValidCoord(destination)) {
      throw new Error('Invalid destination coordinates: latitude must be -90..90 and longitude -180..180');
    }

    const vehicle = (options.vehicle || 'car').toLowerCase();
    const maxAlternatives = options.maxAlternatives !== undefined ? options.maxAlternatives : 2;

    // 2. Try Serverless Proxy Endpoint First (Keeps API key secure on server)
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      try {
        const proxyUrl = new URL('/api/route', window.location.origin);
        proxyUrl.searchParams.append('originLat', origin.lat);
        proxyUrl.searchParams.append('originLng', origin.lng);
        proxyUrl.searchParams.append('destLat', destination.lat);
        proxyUrl.searchParams.append('destLng', destination.lng);
        proxyUrl.searchParams.append('vehicle', vehicle);
        proxyUrl.searchParams.append('maxAlternatives', maxAlternatives.toString());

        const proxyRes = await fetch(proxyUrl.toString(), {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000)
        });

        if (proxyRes.ok) {
          const data = await proxyRes.json();
          if (data.routes && data.routes.length > 0) {
            return this.parseTomTomRoutes(data.routes, vehicle);
          }
        }
      } catch (_) {
        // Fall through to direct call or road simulation
      }
    }

    // 3. Direct TomTom API Fallback
    const apiKey = CONFIG.getTomTomApiKey();
    if (!apiKey || apiKey === 'YOUR_TOMTOM_API_KEY') {
      console.warn('[TomTomAdapter] No valid TomTom API key found. Falling back to local road network simulation.');
      return this.fallbackRoadRoute(origin, destination, options);
    }

    const locations = `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;
    let travelMode = 'car';
    if (vehicle === 'bike' || vehicle === 'bicycle') travelMode = 'bicycle';
    else if (vehicle === 'truck') travelMode = 'truck';
    else if (vehicle === 'pedestrian') travelMode = 'pedestrian';

    const url = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${locations}/json`);
    url.searchParams.append('key', apiKey);
    url.searchParams.append('traffic', 'true');
    url.searchParams.append('travelMode', travelMode);
    url.searchParams.append('routeType', 'fastest');
    url.searchParams.append('computeTravelTimeFor', 'all');
    url.searchParams.append('instructionsType', 'text');
    url.searchParams.append('language', 'en-GB');
    url.searchParams.append('sectionType', 'traffic');
    if (maxAlternatives > 0 && travelMode !== 'pedestrian' && travelMode !== 'bicycle') {
      url.searchParams.append('maxAlternatives', maxAlternatives.toString());
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) {
        let errMessage = `TomTom API Error (${response.status}: ${response.statusText})`;
        try {
          const errData = await response.json();
          if (errData.error?.description) {
            errMessage = errData.error.description;
          } else if (errData.detailedError?.message) {
            errMessage = errData.detailedError.message;
          }
        } catch (_) {}

        if (response.status === 403 || response.status === 401) {
          throw new Error(`TomTom API Key is invalid or unauthorized. Please check your key in Settings.`);
        } else if (response.status === 429) {
          throw new Error(`TomTom API Rate Limit reached. Please wait a moment or update your key.`);
        } else if (response.status === 400) {
          throw new Error(`No drivable route found between origin and destination.`);
        }
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data.routes || data.routes.length === 0) {
        throw new Error('No route could be calculated between these locations.');
      }

      return this.parseTomTomRoutes(data.routes, vehicle);

    } catch (error) {
      console.error('[TomTomAdapter Error]', error);
      throw error;
    }
  }

  /**
   * Transforms raw TomTom route objects into standardized RouteResult models
   */
  parseTomTomRoutes(rawRoutes, vehicle = 'car') {
    const parsedRoutes = rawRoutes.map((rawRoute, idx) => {
      const summary = rawRoute.summary || {};
      const legs = rawRoute.legs || [];
      const guidance = rawRoute.guidance || {};

      const coordinates = [];
      for (const leg of legs) {
        if (leg.points) {
          for (const pt of leg.points) {
            coordinates.push([pt.latitude, pt.longitude]);
          }
        }
      }

      const rawInstructions = guidance.instructions || [];
      const instructions = rawInstructions.map((inst, iIdx) => {
        const maneuverType = this.normalizeManeuver(inst.maneuver || inst.instructionType, inst.turnAngleInDecimalDegrees);
        return {
          id: `inst-${idx}-${iIdx}`,
          message: inst.message || 'Continue along the route',
          street: inst.street || '',
          point: inst.point ? [inst.point.latitude, inst.point.longitude] : null,
          routeOffsetMeters: inst.routeOffsetInMeters || 0,
          travelTimeSeconds: inst.travelTimeInSeconds || 0,
          maneuver: maneuverType,
          turnAngle: inst.turnAngleInDecimalDegrees || 0
        };
      });

      if (instructions.length === 0 && coordinates.length > 0) {
        instructions.push({
          id: `inst-${idx}-start`,
          message: 'Head towards your destination',
          point: coordinates[0],
          routeOffsetMeters: 0,
          travelTimeSeconds: 0,
          maneuver: 'straight'
        });
        instructions.push({
          id: `inst-${idx}-end`,
          message: 'You have arrived at the destination',
          point: coordinates[coordinates.length - 1],
          routeOffsetMeters: summary.lengthInMeters || 0,
          travelTimeSeconds: summary.travelTimeInSeconds || 0,
          maneuver: 'destination'
        });
      }

      const isPrimary = idx === 0;
      const vehicleLabel = vehicle ? ` (${vehicle.toUpperCase()})` : '';
      const name = isPrimary 
        ? `Recommended (Fastest)${vehicleLabel}` 
        : `Alternative Route ${idx}${vehicleLabel}`;

      return new RouteResult({
        id: `route-${idx}`,
        name: name,
        isPrimary: isPrimary,
        distanceMeters: summary.lengthInMeters || 0,
        travelTimeSeconds: summary.travelTimeInSeconds || 0,
        noTrafficTravelTimeSeconds: summary.noTrafficTravelTimeInSeconds || summary.travelTimeInSeconds || 0,
        trafficDelaySeconds: summary.trafficDelayInSeconds || 0,
        coordinates: coordinates,
        instructions: instructions,
        trafficAware: true,
        provider: 'TomTom',
        vehicle: vehicle,
        departureTime: summary.departureTime ? new Date(summary.departureTime) : new Date(),
        arrivalTime: summary.arrivalTime ? new Date(summary.arrivalTime) : new Date(Date.now() + (summary.travelTimeInSeconds || 0) * 1000),
        sections: rawRoute.sections || []
      });
    });

    return {
      primaryRoute: parsedRoutes[0],
      alternativeRoutes: parsedRoutes.slice(1),
      allRoutes: parsedRoutes,
      trafficAware: true
    };
  }

  /**
   * Normalizes TomTom maneuver codes into standard icon names
   */
  normalizeManeuver(instructionType, turnAngle) {
    if (!instructionType) return 'straight';
    const type = instructionType.toUpperCase();

    if (type.includes('ARRIVE') || type.includes('FINISH') || type.includes('DESTINATION')) {
      return 'destination';
    }
    if (type.includes('START') || type.includes('DEPART')) {
      return 'depart';
    }
    if (type.includes('ROUNDABOUT')) {
      return 'roundabout';
    }
    if (type.includes('U_TURN') || type.includes('UTURN')) {
      return 'u-turn';
    }
    if (type.includes('LEFT')) {
      if (type.includes('SHARP') || (turnAngle && turnAngle < -110)) return 'turn-sharp-left';
      if (type.includes('SLIGHT') || (turnAngle && turnAngle > -45 && turnAngle < 0)) return 'turn-slight-left';
      return 'turn-left';
    }
    if (type.includes('RIGHT')) {
      if (type.includes('SHARP') || (turnAngle && turnAngle > 110)) return 'turn-sharp-right';
      if (type.includes('SLIGHT') || (turnAngle && turnAngle < 45 && turnAngle > 0)) return 'turn-slight-right';
      return 'turn-right';
    }
    if (type.includes('KEEP')) {
      return turnAngle && turnAngle < 0 ? 'turn-slight-left' : 'turn-slight-right';
    }
    if (type.includes('FORK') || type.includes('MERGE')) {
      return 'fork';
    }
    return 'straight';
  }

  /**
   * Fallback Road Route Generator (used when key is omitted or for testing offline)
   */
  fallbackRoadRoute(origin, destination, options = {}) {
    const lat1 = origin.lat;
    const lng1 = origin.lng;
    const lat2 = destination.lat;
    const lng2 = destination.lng;

    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightDist = R * c;

    const roadDistanceMeters = Math.round(straightDist * 1.32);
    const points = [];
    const numWaypoints = Math.max(8, Math.min(60, Math.floor(roadDistanceMeters / 150)));

    for (let i = 0; i <= numWaypoints; i++) {
      const t = i / numWaypoints;
      const perpWiggle = Math.sin(t * Math.PI * 3) * (0.0012 * (1 - Math.abs(2 * t - 1)));
      const cosPerp = -dLng * perpWiggle;
      const sinPerp = dLat * perpWiggle;

      const pLat = lat1 + (lat2 - lat1) * t + cosPerp;
      const pLng = lng1 + (lng2 - lng1) * t + sinPerp;
      points.push([pLat, pLng]);
    }

    const avgSpeedKmh = 32;
    const noTrafficSeconds = Math.round((roadDistanceMeters / 1000) / (avgSpeedKmh * 1.25) * 3600);
    const travelTimeSeconds = Math.round((roadDistanceMeters / 1000) / avgSpeedKmh * 3600);
    const trafficDelaySeconds = Math.max(0, travelTimeSeconds - noTrafficSeconds);

    const instructions = [
      {
        id: 'fb-0',
        message: 'Head towards main arterial road',
        street: 'Origin Access Rd',
        point: points[0],
        routeOffsetMeters: 0,
        travelTimeSeconds: 0,
        maneuver: 'depart'
      },
      {
        id: 'fb-1',
        message: 'Turn right onto Sector Road',
        street: 'Sector Road',
        point: points[Math.floor(points.length * 0.25)],
        routeOffsetMeters: Math.round(roadDistanceMeters * 0.25),
        travelTimeSeconds: Math.round(travelTimeSeconds * 0.25),
        maneuver: 'turn-right'
      },
      {
        id: 'fb-2',
        message: 'Keep straight onto NH-48 Expressway Connector',
        street: 'NH-48 Connector',
        point: points[Math.floor(points.length * 0.55)],
        routeOffsetMeters: Math.round(roadDistanceMeters * 0.55),
        travelTimeSeconds: Math.round(travelTimeSeconds * 0.55),
        maneuver: 'straight'
      },
      {
        id: 'fb-3',
        message: 'Take the exit toward destination district',
        street: 'District Link Rd',
        point: points[Math.floor(points.length * 0.85)],
        routeOffsetMeters: Math.round(roadDistanceMeters * 0.85),
        travelTimeSeconds: Math.round(travelTimeSeconds * 0.85),
        maneuver: 'turn-left'
      },
      {
        id: 'fb-4',
        message: 'Arrive at destination store',
        street: 'Store Entrance',
        point: points[points.length - 1],
        routeOffsetMeters: roadDistanceMeters,
        travelTimeSeconds: travelTimeSeconds,
        maneuver: 'destination'
      }
    ];

    const primaryRoute = new RouteResult({
      id: 'route-sim-0',
      name: 'Simulated Road Route (Enter TomTom Key in Settings)',
      isPrimary: true,
      distanceMeters: roadDistanceMeters,
      travelTimeSeconds: travelTimeSeconds,
      noTrafficTravelTimeSeconds: noTrafficSeconds,
      trafficDelaySeconds: trafficDelaySeconds,
      coordinates: points,
      instructions: instructions,
      trafficAware: false,
      provider: 'Simulation'
    });

    return {
      primaryRoute: primaryRoute,
      alternativeRoutes: [],
      allRoutes: [primaryRoute],
      trafficAware: false
    };
  }
}

/**
 * Universal Routing Service Facade
 */
export class RoutingService {
  constructor(adapter = new TomTomRoutingAdapter()) {
    this.adapter = adapter;
  }

  setAdapter(adapter) {
    this.adapter = adapter;
  }

  async calculateRoute(origin, destination, options = {}) {
    return this.adapter.calculateRoute(origin, destination, options);
  }

  async recalculateRoute(currentPosition, destination, options = {}) {
    console.info('[RoutingService] Recalculating route from updated position:', currentPosition);
    return this.adapter.calculateRoute(currentPosition, destination, { ...options, isRecalculation: true });
  }

  getTrafficAwareETA(route) {
    if (!route) return null;
    return {
      distance: route.formattedDistance,
      duration: route.formattedTime,
      normalDuration: route.formattedNormalTime,
      trafficDelay: route.formattedTrafficDelay,
      etaTimestamp: route.formattedETA,
      trafficAware: route.trafficAware,
      provider: route.provider
    };
  }
}

export const routingService = new RoutingService();
