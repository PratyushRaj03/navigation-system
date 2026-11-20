/**
 * Live Navigation Controller
 * Orchestrates real-time GPS tracking, turn-by-turn guidance, cross-track deviation detection,
 * automatic route recalculation, simulation mode, and voice announcements.
 */

import { CONFIG } from '../config/config.js';
import { routingService, RouteResult } from './routing.js';

export class NavigationController {
  constructor(mapManager, dataLoader) {
    this.mapManager = mapManager;
    this.dataLoader = dataLoader;

    // Navigation State
    this.isActive = false;
    this.destination = null;
    this.currentPosition = null; // { lat, lng, heading, accuracy }
    this.activeRoute = null;     // RouteResult
    this.alternativeRoutes = []; // Array<RouteResult>
    this.allRoutes = [];
    this.currentInstructionIndex = 0;
    this.isFollowingCamera = true;
    this.watchId = null;

    // Deviation & Recalculation
    this.autoRecalculateEnabled = true;
    this.isCustomOrigin = false;
    this.customOrigin = null;
    this.offRouteCounter = 0;
    this.lastRecalculateTime = 0;
    this.isRecalculating = false;

    // Simulation Engine
    this.isSimulating = false;
    this.simTimer = null;
    this.simSpeedMultiplier = 1;
    this.simPointIndex = 0;
    this.isSimulatingDeviation = false;
    this.simDeviateVector = null;

    // Voice Guidance (Web Speech API)
    this.voiceEnabled = true;
    this.lastSpokenInstructionId = null;

    this.events = new EventTarget();
  }

  /**
   * Initializes navigation HUD and UI event bindings
   */
  init() {
    this.bindUIEvents();
    this.mapManager.map.on('dragstart', () => {
      if (this.isActive && this.isFollowingCamera) {
        this.setCameraFollow(false);
      }
    });

    // Listen to alternative route selection on map
    this.mapManager.events.addEventListener('selectAlternativeRoute', (e) => {
      this.setActiveRoute(e.detail);
    });

    // When not navigating, clicking any random place directly starts navigation there
    this.setupMapClickToNavigate();
  }

  /**
   * Binds buttons in the Navigation HUD
   */
  bindUIEvents() {
    const endNavBtn = document.getElementById('btn-end-navigation');
    if (endNavBtn) {
      endNavBtn.addEventListener('click', () => this.endNavigation());
    }

    const followBtn = document.getElementById('btn-nav-recenter');
    if (followBtn) {
      followBtn.addEventListener('click', () => this.setCameraFollow(true));
    }

    const voiceBtn = document.getElementById('btn-nav-voice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', () => {
        this.voiceEnabled = !this.voiceEnabled;
        voiceBtn.classList.toggle('active', this.voiceEnabled);
        this.showToast(this.voiceEnabled ? 'Voice Guidance Enabled' : 'Voice Guidance Muted');
      });
    }

    const simDeviateBtn = document.getElementById('btn-sim-deviate');
    if (simDeviateBtn) {
      simDeviateBtn.addEventListener('click', () => this.simulateRouteDeviation());
    }

    const simSpeedBtn = document.getElementById('btn-sim-speed');
    if (simSpeedBtn) {
      simSpeedBtn.addEventListener('click', () => {
        const speeds = [1, 2, 5, 10];
        const nextIdx = (speeds.indexOf(this.simSpeedMultiplier) + 1) % speeds.length;
        this.simSpeedMultiplier = speeds[nextIdx];
        simSpeedBtn.textContent = `${this.simSpeedMultiplier}x`;
      });
    }

    // Navigation Mode Collapsible Outlet Detail Window Events
    const toggleOutletInfoBtn = document.getElementById('btn-toggle-nav-outlet-info');
    if (toggleOutletInfoBtn) {
      toggleOutletInfoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNavOutletWindow();
      });
    }

    const navDestSummaryBtn = document.getElementById('nav-dest-summary-btn');
    if (navDestSummaryBtn) {
      navDestSummaryBtn.addEventListener('click', () => this.toggleNavOutletWindow());
      navDestSummaryBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.toggleNavOutletWindow();
        }
      });
    }

    const navCapsule = document.getElementById('nav-outlet-capsule');
    if (navCapsule) {
      navCapsule.addEventListener('click', () => this.toggleNavOutletWindow(true));
    }

    const collapseNavOutletBtn = document.getElementById('btn-collapse-nav-outlet');
    if (collapseNavOutletBtn) {
      collapseNavOutletBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNavOutletWindow(false);
      });
    }

    const copyNavCoordsBtn = document.getElementById('btn-nav-copy-coords');
    if (copyNavCoordsBtn) {
      copyNavCoordsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyNavDestinationCoords();
      });
    }
  }

  /**
   * Quick Click-to-Navigate:
   * When not currently navigating, clicking anywhere on the map directly starts
   * navigation to that clicked spot with an instant dropped pin and background address lookup.
   */
  setupMapClickToNavigate() {
    if (!this.mapManager || !this.mapManager.map) return;

    this.mapManager.map.on('click', async (e) => {
      // 1. If currently in an active navigation session, ignore map clicks so camera/panning isn't interrupted
      if (this.isActive) return;

      // 2. If user is currently choosing starting point on map:
      if (this.uiManager && this.uiManager.isPickingOriginOnMap) {
        this.uiManager.setCustomOriginFromMap(e.latlng.lat, e.latlng.lng);
        return;
      }

      // 3. If a store marker or cluster was clicked, ignore (handled by marker click)
      if (this.mapManager._markerClickedJustNow) return;

      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      // 3. Create provisional destination object for this clicked point
      const customDest = {
        id: `dropped-pin-${Date.now()}`,
        custName: 'Dropped Pin',
        distName: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        outletType: 'Custom Destination',
        lat: lat,
        lng: lng,
        color: { hex: '#00f0ff', textContrastColor: '#000000', name: 'Cyan Neon' },
        isDroppedPin: true
      };

      // 4. Place destination pin marker on the map and open outlet card with manual "Navigate Here" option
      this.mapManager.selectOutlet(customDest, false);

      // 5. Reverse-geocode in background to enrich card & marker with real street / area name
      this.reverseGeocodeAndUpdateCard(customDest);
    });
  }

  /**
   * Reverse geocodes coordinates in background and updates destination details on card and HUD
   */
  async reverseGeocodeAndUpdateCard(dest) {
    if (!dest || typeof dest.lat !== 'number' || typeof dest.lng !== 'number') return;

    try {
      let title = null;
      let subtitle = null;

      // 1. Try serverless reverse geocode endpoint /api/search?reverse=true
      try {
        const res = await fetch(`/api/search?reverse=true&lat=${dest.lat.toFixed(5)}&lon=${dest.lng.toFixed(5)}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.title && data.title !== 'Dropped Pin') {
            title = data.title;
            subtitle = data.subtitle || data.fullAddress;
          }
        }
      } catch (err) {
        // Fallback to client-side reverse geocoding
      }

      // 2. Direct TomTom client-side reverse geocoding fallback
      if (!title) {
        const apiKey = CONFIG.getTomTomApiKey();
        if (apiKey) {
          try {
            const url = `https://api.tomtom.com/search/2/reverseGeocode/${dest.lat.toFixed(5)},${dest.lng.toFixed(5)}.json?key=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
              const data = await res.json();
              if (data && data.addresses && data.addresses.length > 0) {
                const addr = data.addresses[0].address;
                title = addr.streetName || addr.street || addr.freeformAddress || addr.municipalitySubdivision;
                const parts = [addr.municipalitySubdivision, addr.municipality, addr.countrySubdivision].filter(Boolean);
                subtitle = parts.join(', ') || addr.freeformAddress;
              }
            }
          } catch (ttErr) {
            // Ignore
          }
        }
      }

      // 3. Photon OSM reverse geocoding fallback
      if (!title) {
        try {
          const photonUrl = `https://photon.komoot.io/reverse?lat=${dest.lat.toFixed(5)}&lon=${dest.lng.toFixed(5)}`;
          const res = await fetch(photonUrl, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const data = await res.json();
            if (data && data.features && data.features.length > 0) {
              const props = data.features[0].properties;
              title = props.name || props.street || props.district || props.city;
              subtitle = [props.street, props.district, props.city, props.state].filter(Boolean).join(', ');
            }
          }
        } catch (osmErr) {
          // Ignore
        }
      }

      // If a real address/place name was discovered, update destination object, popup card, and active HUD
      if (title) {
        dest.custName = title;
        if (subtitle) dest.distName = subtitle;

        // Update popup card if open
        const cardNameEl = document.getElementById('card-outlet-cust-name');
        const cardDistEl = document.getElementById('card-outlet-dist-name');
        const cardDestText = document.getElementById('card-dest-text');
        if (cardNameEl) cardNameEl.textContent = title;
        if (cardDestText) cardDestText.textContent = title;
        if (cardDistEl) cardDistEl.textContent = subtitle || `${dest.lat.toFixed(4)}, ${dest.lng.toFixed(4)}`;

        // Update active HUD if navigation was already launched
        if (this.isActive && this.destination && this.destination.id === dest.id) {
          this.destination.custName = title;
          if (subtitle) this.destination.distName = subtitle;

          const destNameEl = document.getElementById('nav-dest-name');
          const destSubEl = document.getElementById('nav-dest-sub');
          if (destNameEl) {
            destNameEl.textContent = title;
            destNameEl.title = title;
          }
          if (destSubEl) {
            const cleanAddr = this.formatAddressSubtitle(this.destination.distName);
            destSubEl.textContent = cleanAddr ? `${cleanAddr} • Location` : 'Location';
            destSubEl.title = this.destination.distName;
          }

          // Update saved session with real address
          this.saveNavigationSession();
        }
      }
    } catch (err) {
      console.warn('[Navigation] Reverse geocode background update error:', err);
    }
  }

  /**
   * Starts navigation to a selected destination outlet
   * @param {object} destinationOutlet 
   * @param {object|null} initialOrigin { lat, lng }
   * @param {boolean} startSimulation
   * @param {number} initialSimIndex
   */
  async startNavigation(destinationOutlet, initialOrigin = null, startSimulation = false, initialSimIndex = 0) {
    if (!destinationOutlet) return;

    this.destination = destinationOutlet;
    this.isActive = true;
    this.isCustomOrigin = Boolean(initialOrigin);
    this.customOrigin = initialOrigin;
    this.currentInstructionIndex = 0;
    this.offRouteCounter = 0;
    this.lastSpokenInstructionId = null;

    // Show navigation UI HUD
    this.showNavigationHUD(destinationOutlet);

    // Emphasize destination marker on map
    this.mapManager.setDestinationHighlight(destinationOutlet);

    // Acquire origin coordinates (use initialOrigin, previously acquired GPS, or query now)
    let origin = initialOrigin || this.currentPosition;

    if (!origin) {
      try {
        origin = await this.getCurrentLocationPromise();
      } catch (err) {
        console.warn('[Navigation] Geolocation error:', err);
        // If GPS is unavailable/denied, default origin near destination region or Delhi center
        origin = this.getDefaultOrigin(destinationOutlet);
        this.showToast('Using approximate departure point.', 'warning');
      }
    }

    this.currentPosition = origin;
    if (this.isCustomOrigin) {
      this.mapManager.setCustomOriginMarker(origin);
    } else {
      this.mapManager.clearCustomOriginMarker();
      this.mapManager.updateUserLocation(this.currentPosition);
    }

    this.saveNavigationSession();

    // Calculate initial traffic-aware route
    await this.calculateAndRenderRoute(origin, destinationOutlet);

    // Start live GPS tracking or simulation:
    // Only run animated car simulation if startSimulation was explicitly requested (e.g. "Drive (Sim)" button)
    // For custom origins, show the full route, total distance, and time without starting auto-simulation!
    if (startSimulation) {
      this.startSimulation(initialSimIndex);
    } else if (this.isCustomOrigin) {
      this.isSimulating = false;
      this.setupCustomOriginRoutePreview();
    } else {
      this.startLiveGPSTracking();
    }
  }

  /**
   * Sets up static route preview for custom origins:
   * Displays full route polyline, total distance, travel duration, and ETA without moving the vehicle
   */
  setupCustomOriginRoutePreview() {
    this.isSimulating = false;
    clearInterval(this.simTimer);

    // Hide simulation-specific controls panel
    const simPanel = document.getElementById('sim-controls-panel');
    if (simPanel) simPanel.style.display = 'none';

    // Auto-fit map to the full route bounds so the entire path is visible from start to destination
    if (this.activeRoute && this.activeRoute.coordinates && this.mapManager && this.mapManager.map) {
      try {
        const bounds = L.latLngBounds(this.activeRoute.coordinates);
        this.mapManager.map.fitBounds(bounds, {
          padding: [80, 80],
          maxZoom: 16,
          animate: true
        });
      } catch (_) {}
    }

    // Update HUD metrics with total distance, duration, and ETA
    if (this.activeRoute) {
      this.updateHUDRouteDetails(this.activeRoute);
      this.updateNextInstruction(0, 0);

      const firstStep = this.activeRoute.instructions?.[0];
      const instText = firstStep ? firstStep.message : `Route to ${this.destination.custName}`;
      const instEl = document.getElementById('nav-instruction-text');
      if (instEl) instEl.textContent = instText;

      const turnDistEl = document.getElementById('nav-turn-distance');
      if (turnDistEl) turnDistEl.textContent = this.activeRoute.formattedDistance;

      const originName = (this.customOrigin && this.customOrigin.name) ? this.customOrigin.name : 'Starting Point';
      this.showToast(`Route: ${originName} → ${this.destination.custName} (${this.activeRoute.formattedDistance} • ${this.activeRoute.formattedTime})`, 'info');
    }
  }

  /**
   * Calculates route from origin to destination and displays polylines
   */
  async calculateAndRenderRoute(origin, destination, isRecalculation = false) {
    if (isRecalculation) {
      this.setReroutingHUD(true);
    } else {
      this.setNavStatus('Calculating fastest route with traffic...');
    }

    try {
      const result = await routingService.calculateRoute(
        { lat: origin.lat, lng: origin.lng },
        { lat: destination.lat, lng: destination.lng },
        { maxAlternatives: 2 }
      );

      this.allRoutes = result.allRoutes || [result.primaryRoute];
      this.alternativeRoutes = result.alternativeRoutes || [];
      this.setActiveRoute(result.primaryRoute, false);

      if (isRecalculation) {
        // Resume simulation on the new route seamlessly
        this.isSimulatingDeviation = false;
        this.simPointIndex = 0;
        this.showToast('New route calculated to avoid wrong turn!', 'info');

        const firstStep = result.primaryRoute.instructions?.[0];
        const maneuverMsg = firstStep ? firstStep.message : 'Follow the newly calculated route.';
        this.speakInstruction(`New route found. ${maneuverMsg}`);
      }
    } catch (error) {
      console.error('[Navigation] Route calculation failed:', error);
      this.setNavStatus('Route calculation error');
      this.showToast(error.message || 'Unable to calculate road route', 'error');
    } finally {
      if (isRecalculation) {
        this.setReroutingHUD(false);
      }
    }
  }

  /**
   * Toggles HUD visual appearance during rerouting
   * @param {boolean} active 
   */
  setReroutingHUD(active) {
    const maneuverIconEl = document.getElementById('nav-maneuver-icon');
    const instructionTextEl = document.getElementById('nav-instruction-text');
    const turnDistanceEl = document.getElementById('nav-turn-distance');
    const trafficDelayEl = document.getElementById('nav-traffic-delay');

    if (active) {
      if (maneuverIconEl) maneuverIconEl.innerHTML = this.getManeuverSVG('rerouting');
      if (instructionTextEl) instructionTextEl.textContent = 'Recalculating route...';
      if (turnDistanceEl) turnDistanceEl.textContent = 'Rerouting';
      if (trafficDelayEl) {
        trafficDelayEl.innerHTML = '<span class="traffic-dot rerouting"></span><span>Rerouting...</span>';
        trafficDelayEl.className = 'traffic-badge delayed pulse-reroute';
      }
    } else {
      if (trafficDelayEl && this.activeRoute) {
        if (this.activeRoute.trafficDelaySeconds > 60) {
          const mins = Math.round(this.activeRoute.trafficDelaySeconds / 60);
          trafficDelayEl.innerHTML = `<span class="traffic-dot delayed"></span><span>+${mins}m delay</span>`;
          trafficDelayEl.className = 'traffic-badge delayed';
        } else {
          trafficDelayEl.innerHTML = `<span class="traffic-dot"></span><span>Fastest route</span>`;
          trafficDelayEl.className = 'traffic-badge on-time';
        }
      }
    }
  }

  /**
   * Sets the active navigation route and updates UI
   */
  setActiveRoute(route, fitToRoute = true) {
    if (!route) return;

    this.activeRoute = route;
    this.currentInstructionIndex = 0;

    // Render polyline on map
    this.mapManager.displayRoute(this.activeRoute, this.alternativeRoutes);

    // Update navigation HUD info
    this.updateHUDRouteDetails(this.activeRoute);
    this.updateNextInstruction(0, 0);

    // Render alternative route switcher tabs
    this.renderAlternativeRouteTabs();
  }

  /**
   * Renders clickable route alternative tabs
   */
  renderAlternativeRouteTabs() {
    const tabsContainer = document.getElementById('nav-route-tabs');
    if (!tabsContainer) return;

    if (this.allRoutes.length <= 1) {
      tabsContainer.innerHTML = '';
      tabsContainer.style.display = 'none';
      return;
    }

    tabsContainer.style.display = 'flex';
    tabsContainer.innerHTML = this.allRoutes.map((r, idx) => {
      const isSelected = r.id === this.activeRoute.id;
      const mins = Math.round(r.travelTimeSeconds / 60);
      const delayBadge = r.trafficDelaySeconds > 60 
        ? `<span class="tab-delay">+${Math.round(r.trafficDelaySeconds / 60)}m</span>` 
        : '';

      return `
        <button class="route-tab-btn ${isSelected ? 'active' : ''}" data-route-id="${r.id}">
          <div class="tab-title">${r.name.replace('Alternative Route ', 'Alt ')}</div>
          <div class="tab-meta">${r.formattedDistance} &bull; ${mins} min ${delayBadge}</div>
        </button>
      `;
    }).join('');

    const btns = tabsContainer.querySelectorAll('.route-tab-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const rId = btn.dataset.routeId;
        const targetRoute = this.allRoutes.find(r => r.id === rId);
        if (targetRoute && targetRoute.id !== this.activeRoute.id) {
          this.setActiveRoute(targetRoute, false);
        }
      });
    });
  }

  /**
   * Starts high-accuracy GPS tracking via browser geolocation
   */
  startLiveGPSTracking() {
    if (!navigator.geolocation) {
      this.showToast('Geolocation is not supported by your browser', 'error');
      return;
    }

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
    }

    const geoOptions = {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 10000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handleGPSUpdate(position),
      (error) => this.handleGPSError(error),
      geoOptions
    );

    console.info('[Navigation] Geolocation watch started.');
  }

  /**
   * Handles incoming GPS location update
   * @param {GeolocationPosition} position 
   */
  handleGPSUpdate(position) {
    if (!this.isActive) return;

    // If navigation departed from a custom origin, do not allow physical device GPS
    // (which may be miles away at user's current location) to hijack and reroute the route!
    if (this.isCustomOrigin) {
      return;
    }

    const coords = position.coords;
    const newPos = {
      lat: coords.latitude,
      lng: coords.longitude,
      heading: coords.heading,
      speed: coords.speed,
      accuracy: coords.accuracy
    };

    this.processPositionUpdate(newPos);
  }

  /**
   * Processes position update for guidance, camera following, and deviation check
   * @param {object} pos { lat, lng, heading, speed, accuracy }
   */
  processPositionUpdate(pos) {
    this.currentPosition = pos;

    // Save session so page refresh retains exact progress
    this.saveNavigationSession();

    // Update GPS icon on map
    this.mapManager.updateUserLocation(pos);

    // Auto-center camera if follow mode is active
    if (this.isFollowingCamera && this.mapManager.map) {
      this.mapManager.map.panTo([pos.lat, pos.lng], {
        animate: true,
        duration: 0.5
      });
    }

    if (!this.activeRoute || !this.activeRoute.coordinates || this.activeRoute.coordinates.length === 0) {
      return;
    }

    // 1. Check if user reached destination
    const distToDest = this.getHaversineDistance(
      pos.lat, pos.lng,
      this.destination.lat, this.destination.lng
    );

    if (distToDest <= CONFIG.NAVIGATION.ARRIVAL_THRESHOLD_METERS) {
      this.handleArrival();
      return;
    }

    // 2. Check for route deviation
    this.checkRouteDeviation(pos);

    // 3. Update turn-by-turn guidance progress if not actively rerouting
    if (!this.isRecalculating) {
      this.updateGuidanceProgress(pos);
    }
  }

  /**
   * Detects if the user has deviated off-route
   * @param {object} pos 
   */
  checkRouteDeviation(pos) {
    if (!this.autoRecalculateEnabled || this.isRecalculating || !this.activeRoute) return;

    // When navigating from a custom origin, do not allow physical device GPS to trigger rerouting
    // unless the user intentionally clicked 'Test Wrong Turn' simulation
    if (this.isCustomOrigin && !this.isSimulatingDeviation) return;

    const minCrossTrackDist = this.getMinDistanceToPolyline(pos, this.activeRoute.coordinates);

    if (!Number.isFinite(minCrossTrackDist)) return;

    const now = Date.now();
    const isCoolDownOver = now - this.lastRecalculateTime > (CONFIG.NAVIGATION.MIN_RECALCULATE_INTERVAL_MS || 3000);

    const fastThreshold = CONFIG.NAVIGATION.FAST_DEVIATION_THRESHOLD_METERS || 45;
    const standardThreshold = CONFIG.NAVIGATION.DEVIATION_THRESHOLD_METERS || 28;

    // Fast-path: clear sharp wrong turn onto adjacent street/fork
    if (minCrossTrackDist > fastThreshold && isCoolDownOver) {
      console.warn(`[Navigation] Sharp wrong turn detected! Distance: ${minCrossTrackDist.toFixed(1)}m. Immediate reroute.`);
      this.triggerRerouting(pos);
      return;
    }

    // Standard deviation path: 28m - 45m (with confirmation counter)
    if (minCrossTrackDist > standardThreshold) {
      this.offRouteCounter++;
      console.warn(`[Navigation] Off-route detected! Distance: ${minCrossTrackDist.toFixed(1)}m (Count: ${this.offRouteCounter})`);

      if (this.offRouteCounter >= (CONFIG.NAVIGATION.DEVIATION_CONFIRMATION_COUNT || 2) && isCoolDownOver) {
        this.triggerRerouting(pos);
      }
    } else {
      this.offRouteCounter = 0;
    }
  }

  /**
   * Triggers the Google Maps style rerouting sequence
   * @param {object} pos 
   */
  triggerRerouting(pos) {
    this.isRecalculating = true;
    this.lastRecalculateTime = Date.now();
    this.offRouteCounter = 0;

    // Immediately alert user visually & audibly just like Google Maps
    this.setReroutingHUD(true);
    this.speakInstruction('Rerouting.');
    this.showToast('Wrong turn detected — rerouting...', 'warning');

    this.calculateAndRenderRoute(pos, this.destination, true)
      .finally(() => {
        this.isRecalculating = false;
      });
  }

  /**
   * Updates next instruction and distance to next maneuver
   */
  updateGuidanceProgress(pos) {
    if (!this.activeRoute || !this.activeRoute.instructions || this.activeRoute.instructions.length === 0) {
      return;
    }

    const instructions = this.activeRoute.instructions;
    let closestStepIdx = 0;
    let minStepDist = Infinity;

    // Find nearest future instruction point
    for (let i = 0; i < instructions.length; i++) {
      const step = instructions[i];
      if (step.point) {
        const d = this.getHaversineDistance(pos.lat, pos.lng, step.point[0], step.point[1]);
        if (d < minStepDist) {
          minStepDist = d;
          closestStepIdx = i;
        }
      }
    }

    this.currentInstructionIndex = closestStepIdx;
    const nextStep = instructions[closestStepIdx] || instructions[0];
    const distToTurn = minStepDist !== Infinity ? minStepDist : 100;

    this.updateNextInstruction(closestStepIdx, distToTurn);

    // Voice announcement trigger if near maneuver
    if (this.voiceEnabled && nextStep.id !== this.lastSpokenInstructionId && distToTurn < 120) {
      this.lastSpokenInstructionId = nextStep.id;
      const turnMsg = distToTurn > 40 
        ? `In ${Math.round(distToTurn)} meters, ${nextStep.message}` 
        : nextStep.message;
      this.speakInstruction(turnMsg);
    }
  }

  /**
   * Updates the top maneuver banner in the HUD
   */
  updateNextInstruction(instructionIndex, distMeters) {
    const instructions = this.activeRoute?.instructions || [];
    const step = instructions[instructionIndex] || {
      maneuver: 'straight',
      message: 'Continue along the route to ' + this.destination.custName
    };

    const maneuverIconEl = document.getElementById('nav-maneuver-icon');
    const instructionTextEl = document.getElementById('nav-instruction-text');
    const turnDistanceEl = document.getElementById('nav-turn-distance');

    if (maneuverIconEl) {
      maneuverIconEl.innerHTML = this.getManeuverSVG(step.maneuver);
    }

    if (instructionTextEl) {
      instructionTextEl.textContent = step.message;
    }

    if (turnDistanceEl) {
      if (distMeters >= 1000) {
        turnDistanceEl.textContent = `${(distMeters / 1000).toFixed(1)} km`;
      } else {
        turnDistanceEl.textContent = `${Math.round(distMeters)} m`;
      }
    }
  }

  /**
   * Updates bottom status bar in HUD (ETA, Remaining distance, Travel time, Traffic delay)
   */
  updateHUDRouteDetails(route) {
    const destNameEl = document.getElementById('nav-dest-name');
    const destSubEl = document.getElementById('nav-dest-sub');
    const etaEl = document.getElementById('nav-eta-value');
    const remainingDistEl = document.getElementById('nav-remaining-dist');
    const remainingTimeEl = document.getElementById('nav-remaining-time');
    const trafficDelayEl = document.getElementById('nav-traffic-delay');

    if (destNameEl && this.destination) {
      destNameEl.textContent = this.destination.custName;
      destNameEl.title = this.destination.custName;
    }
    if (destSubEl && this.destination) {
      const formattedType = this.formatCategoryName(this.destination.outletType);
      const cleanAddress = this.formatAddressSubtitle(this.destination.distName);
      destSubEl.textContent = cleanAddress ? `${cleanAddress} • ${formattedType}` : formattedType;
      destSubEl.title = `${this.destination.distName || ''} (${formattedType})`;
    }
    if (etaEl) {
      etaEl.textContent = route.formattedETA;
    }
    if (remainingDistEl) {
      remainingDistEl.textContent = route.formattedDistance;
    }
    if (remainingTimeEl) {
      remainingTimeEl.textContent = route.formattedTime;
    }
    if (trafficDelayEl) {
      if (route.trafficDelaySeconds > 60) {
        const mins = Math.round(route.trafficDelaySeconds / 60);
        trafficDelayEl.innerHTML = `<span class="traffic-dot delayed"></span><span>+${mins}m delay</span>`;
        trafficDelayEl.className = 'traffic-badge delayed';
      } else {
        trafficDelayEl.innerHTML = `<span class="traffic-dot"></span><span>Fastest route</span>`;
        trafficDelayEl.className = 'traffic-badge on-time';
      }
    }
  }

  /**
   * Cleans and formats raw POI / outlet category strings for display
   */
  formatCategoryName(type) {
    if (!type) return 'Destination';
    const cleaned = type
      .replace(/_/g, ' ')
      .toLowerCase()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    if (cleaned.includes('College') || cleaned.includes('University')) return 'University';
    if (cleaned.includes('Shopping') || cleaned.includes('Mall')) return 'Shopping Mall';
    if (cleaned.includes('Park') || cleaned.includes('Recreation')) return 'Park';
    if (cleaned.includes('Hospital') || cleaned.includes('Clinic')) return 'Hospital';
    if (cleaned.includes('Apartment') || cleaned.includes('Residential')) return 'Apartment';
    if (cleaned.includes('Restaurant') || cleaned.includes('Cafe') || cleaned.includes('Food')) return 'Restaurant';
    if (cleaned.includes('Landmark') || cleaned.includes('Place')) return 'Landmark';
    return cleaned.length > 18 ? cleaned.slice(0, 16) + '...' : cleaned;
  }

  /**
   * Formats long address strings into clean, concise locality / city labels
   */
  formatAddressSubtitle(addr) {
    if (!addr) return '';
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length <= 2) return parts.join(', ');
    // Show first meaningful road/area and city
    const first = parts[0];
    const second = parts[parts.length - 2] || parts[parts.length - 1];
    return `${first}, ${second}`;
  }

  /**
   * Sets camera follow state and updates button icon
   */
  setCameraFollow(enabled) {
    this.isFollowingCamera = enabled;
    const followBtn = document.getElementById('btn-nav-recenter');
    if (followBtn) {
      followBtn.classList.toggle('active', enabled);
    }
    if (enabled && this.mapManager.map) {
      if (this.isCustomOrigin && !this.isSimulating && this.activeRoute?.coordinates) {
        try {
          const bounds = L.latLngBounds(this.activeRoute.coordinates);
          this.mapManager.map.fitBounds(bounds, { padding: [80, 80], animate: true });
        } catch (_) {}
      } else if (this.currentPosition) {
        this.mapManager.map.setView(
          [this.currentPosition.lat, this.currentPosition.lng],
          CONFIG.NAVIGATION.FOLLOW_ZOOM_LEVEL,
          { animate: true }
        );
      }
    }
  }

  /**
   * Interactive Drive Simulator
   * Iterates along route polyline coordinates to simulate live driving
   * @param {number} initialIndex
   */
  startSimulation(initialIndex = 0) {
    this.isSimulating = true;
    this.simPointIndex = Math.max(0, initialIndex || 0);
    this.isSimulatingDeviation = false;
    this.simDeviateVector = null;

    const simPanel = document.getElementById('sim-controls-panel');
    if (simPanel) simPanel.style.display = 'flex';

    if (!this.activeRoute || !this.activeRoute.coordinates || this.activeRoute.coordinates.length === 0) {
      return;
    }

    const intervalMs = 600;

    clearInterval(this.simTimer);
    this.simTimer = setInterval(() => {
      if (!this.isActive || !this.isSimulating) {
        clearInterval(this.simTimer);
        return;
      }

      // If simulated wrong turn is currently active
      if (this.isSimulatingDeviation && this.simDeviateVector) {
        const nextPos = {
          lat: this.currentPosition.lat + this.simDeviateVector.dLat,
          lng: this.currentPosition.lng + this.simDeviateVector.dLng,
          heading: this.simDeviateVector.heading,
          speed: 40 / 3.6,
          accuracy: 5
        };
        this.processPositionUpdate(nextPos);
        return;
      }

      // Read current active route coordinates dynamically (ensures newly calculated routes work instantly!)
      const coords = this.activeRoute ? this.activeRoute.coordinates : [];
      if (!coords || coords.length === 0) return;

      if (this.simPointIndex >= coords.length) {
        this.handleArrival();
        clearInterval(this.simTimer);
        return;
      }

      const currentPt = coords[this.simPointIndex];
      const nextPt = coords[Math.min(this.simPointIndex + 1, coords.length - 1)];
      const heading = this.calculateBearing(currentPt[0], currentPt[1], nextPt[0], nextPt[1]);

      const simulatedPos = {
        lat: currentPt[0],
        lng: currentPt[1],
        heading: heading,
        speed: 45 / 3.6,
        accuracy: 5
      };

      this.processPositionUpdate(simulatedPos);

      // Advance simulated step based on speed multiplier
      this.simPointIndex += Math.max(1, this.simSpeedMultiplier);
    }, intervalMs);
  }

  /**
   * Simulates taking an actual wrong turn to test automatic rerouting
   */
  simulateRouteDeviation() {
    if (!this.currentPosition) return;

    this.showToast('Simulating wrong turn off-route...', 'warning');

    // Steer 90 degrees away from current heading
    const wrongHeading = ((this.currentPosition.heading || 0) + 90) % 360;
    const rad = (wrongHeading * Math.PI) / 180;
    // Step displacement for ~50m off route
    const dLat = Math.cos(rad) * 0.00045;
    const dLng = Math.sin(rad) * 0.00055;

    this.simDeviateVector = { dLat, dLng, heading: wrongHeading };
    this.isSimulatingDeviation = true;

    // Immediately trigger deviation by moving off route
    const deviatedPos = {
      lat: this.currentPosition.lat + dLat * 1.5,
      lng: this.currentPosition.lng + dLng * 1.5,
      heading: wrongHeading,
      speed: 40 / 3.6,
      accuracy: 5
    };

    this.processPositionUpdate(deviatedPos);
  }

  /**
   * Reached destination handler
   */
  handleArrival() {
    this.clearNavigationSession();
    this.speakInstruction(`You have arrived at ${this.destination.custName}. Navigation complete.`);
    this.showToast(`Arrived at ${this.destination.custName}!`, 'success');
    this.updateNextInstruction(0, 0);

    const instEl = document.getElementById('nav-instruction-text');
    if (instEl) instEl.textContent = `Arrived at destination: ${this.destination.custName}`;

    clearInterval(this.simTimer);
    this.isSimulating = false;
  }

  /**
   * Ends navigation cleanly
   */
  endNavigation() {
    this.clearNavigationSession();
    this.isActive = false;
    this.isCustomOrigin = false;
    this.customOrigin = null;
    this.isSimulating = false;
    clearInterval(this.simTimer);

    if (this.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    // Clean map overlays (retaining all outlets!)
    this.mapManager.endNavigation();

    // Hide HUD
    this.hideNavigationHUD();

    this.showToast('Navigation ended. All outlets restored.', 'info');
    console.info('[Navigation] Navigation ended.');
  }

  /**
   * Restores active navigation session across page reloads
   */
  async restoreNavigationSessionIfAny() {
    try {
      const raw = localStorage.getItem('fleetnav_active_navigation');
      if (!raw) return false;
      const session = JSON.parse(raw);
      if (!session || !session.destination) return false;

      // Expire session after 6 hours
      if (session.savedAt && (Date.now() - session.savedAt > 6 * 60 * 60 * 1000)) {
        this.clearNavigationSession();
        return false;
      }

      const dest = session.destination;
      const initialPos = session.customOrigin || session.currentPosition || null;
      const isSim = Boolean(session.isSimulating || session.isCustomOrigin);
      const simIdx = session.simPointIndex || 0;
      if (session.simSpeedMultiplier) {
        this.simSpeedMultiplier = session.simSpeedMultiplier;
        const hudSpeedBtn = document.getElementById('btn-sim-speed');
        if (hudSpeedBtn) hudSpeedBtn.textContent = `${this.simSpeedMultiplier}x`;
      }

      console.info('[Navigation] Restoring active navigation to:', dest.custName);
      this.showToast(`Resuming navigation to ${dest.custName}...`, 'info');

      await this.startNavigation(dest, initialPos, isSim, simIdx);
      return true;
    } catch (err) {
      console.warn('[Navigation] Failed to restore navigation session:', err);
      this.clearNavigationSession();
      return false;
    }
  }

  /**
   * Persists active navigation state to localStorage
   */
  saveNavigationSession() {
    if (!this.isActive || !this.destination) return;
    try {
      const session = {
        destination: this.destination,
        currentPosition: this.currentPosition,
        isCustomOrigin: this.isCustomOrigin,
        customOrigin: this.customOrigin,
        isSimulating: this.isSimulating,
        simPointIndex: this.simPointIndex,
        simSpeedMultiplier: this.simSpeedMultiplier,
        savedAt: Date.now()
      };
      localStorage.setItem('fleetnav_active_navigation', JSON.stringify(session));
    } catch (_) {}
  }

  /**
   * Clears saved navigation session from localStorage
   */
  clearNavigationSession() {
    try {
      localStorage.removeItem('fleetnav_active_navigation');
    } catch (_) {}
  }

  /**
   * Text-to-Speech Voice Guidance using browser Web Speech API
   */
  speakInstruction(text) {
    if (!this.voiceEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (_) {}
  }

  /**
   * Geolocation Promise Wrapper
   */
  getCurrentLocationPromise() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          accuracy: pos.coords.accuracy
        }),
        (err) => reject(err),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  /**
   * Proactively requests user GPS location, updates map marker and user location coordinates
   * @param {boolean} centerOnMap
   * @returns {Promise<{success: boolean, position?: object, error?: any}>}
   */
  async requestUserLocation(centerOnMap = true) {
    try {
      const pos = await this.getCurrentLocationPromise();
      this.currentPosition = pos;
      this.mapManager.updateUserLocation(pos);
      if (centerOnMap) {
        this.mapManager.recenterUserLocation(15);
      }
      return { success: true, position: pos };
    } catch (err) {
      console.warn('[Navigation] Request user location failed:', err);
      return { success: false, error: err };
    }
  }

  /**
   * Returns reasonable origin in dataset vicinity when GPS is unavailable
   */
  getDefaultOrigin(dest) {
    // Return origin ~3-5km offset from destination to demonstrate genuine road routing
    return {
      lat: dest.lat - 0.035,
      lng: dest.lng - 0.028,
      heading: 45,
      accuracy: 25
    };
  }

  handleGPSError(error) {
    let msg = 'GPS location error';
    switch (error.code) {
      case error.PERMISSION_DENIED:
        msg = 'Location permission denied. Live tracking disabled.';
        break;
      case error.POSITION_UNAVAILABLE:
        msg = 'GPS signal unavailable. Please ensure location is enabled.';
        break;
      case error.TIMEOUT:
        msg = 'Location request timed out.';
        break;
    }
    this.showToast(msg, 'warning');
  }

  /**
   * Computes shortest perpendicular distance from a point to a polyline in meters
   * Guaranteed never to return NaN even on duplicate or degenerate polyline segments
   */
  getMinDistanceToPolyline(point, polyline) {
    if (!point || !polyline || polyline.length < 2) return Infinity;
    let minDist = Infinity;
    for (let i = 0; i < polyline.length - 1; i++) {
      const p1 = polyline[i];
      const p2 = polyline[i + 1];
      if (!p1 || !p2) continue;
      const dist = this.distToSegment(point, { lat: p1[0], lng: p1[1] }, { lat: p2[0], lng: p2[1] });
      if (Number.isFinite(dist) && dist < minDist) {
        minDist = dist;
      }
    }
    return Number.isFinite(minDist) ? minDist : Infinity;
  }

  /**
   * Distance from point to line segment in physical meters using planar projection
   * Safe against zero-length segments and floating point edge cases
   */
  distToSegment(p, v, w) {
    if (!p || !v || !w) return Infinity;
    const midLat = ((v.lat + w.lat + p.lat) / 3) * (Math.PI / 180);
    const cosLat = Math.cos(midLat);

    // Convert degrees to physical meters relative to v
    const wx = (w.lng - v.lng) * cosLat * 111320;
    const wy = (w.lat - v.lat) * 110540;
    const px = (p.lng - v.lng) * cosLat * 111320;
    const py = (p.lat - v.lat) * 110540;

    const segLenSq = wx * wx + wy * wy;
    if (segLenSq < 0.25) { // Segment length under 0.5 meters or identical points
      return Math.hypot(px, py);
    }

    const t = Math.max(0, Math.min(1, (px * wx + py * wy) / segLenSq));
    const projX = t * wx;
    const projY = t * wy;
    const dist = Math.hypot(px - projX, py - projY);
    return Number.isFinite(dist) ? dist : Math.hypot(px, py);
  }

  /**
   * Great Circle Haversine Distance in meters
   */
  getHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /**
   * Calculate bearing between two coordinate points
   */
  calculateBearing(startLat, startLng, destLat, destLng) {
    const y = Math.sin((destLng - startLng) * Math.PI / 180) * Math.cos(destLat * Math.PI / 180);
    const x = Math.cos(startLat * Math.PI / 180) * Math.sin(destLat * Math.PI / 180) -
              Math.sin(startLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) * Math.cos((destLng - startLng) * Math.PI / 180);
    const brng = Math.atan2(y, x) * 180 / Math.PI;
    return (brng + 360) % 360;
  }

  showNavigationHUD(destination) {
    const hud = document.getElementById('navigation-hud');
    if (hud) hud.classList.add('active');
    document.body.classList.add('navigation-active');
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar && window.innerWidth <= 768) {
      sidebar.classList.add('collapsed');
      sidebar.classList.remove('mobile-open');
      const backdrop = document.getElementById('sidebar-backdrop');
      if (backdrop) backdrop.classList.remove('visible');
    }
    const outletCard = document.getElementById('outlet-detail-card');
    if (outletCard) {
      outletCard.classList.remove('active');
      outletCard.classList.remove('visible');
    }
    const floatingControls = document.querySelector('.map-floating-controls');
    if (floatingControls && window.innerWidth <= 768) {
      floatingControls.style.display = 'none';
    }

    if (destination) {
      const destNameEl = document.getElementById('nav-dest-name');
      const destSubEl = document.getElementById('nav-dest-sub');
      if (destNameEl) {
        destNameEl.textContent = destination.custName;
        destNameEl.title = destination.custName;
      }
      if (destSubEl) {
        const formattedType = this.formatCategoryName(destination.outletType);
        const cleanAddress = this.formatAddressSubtitle(destination.distName);
        destSubEl.textContent = cleanAddress ? `${cleanAddress} • ${formattedType}` : formattedType;
        destSubEl.title = `${destination.distName || ''} (${formattedType})`;
      }

      // Display collapsible destination outlet details window
      this.showNavOutletWindow(destination);
    }
  }

  hideNavigationHUD() {
    const hud = document.getElementById('navigation-hud');
    if (hud) hud.classList.remove('active');
    document.body.classList.remove('navigation-active');
    const simPanel = document.getElementById('sim-controls-panel');
    if (simPanel) simPanel.style.display = 'none';
    const floatingControls = document.querySelector('.map-floating-controls');
    if (floatingControls) {
      floatingControls.style.display = '';
    }

    // Hide collapsible outlet details window
    this.hideNavOutletWindow();
  }

  /**
   * Updates and displays the collapsible outlet detail window during active navigation.
   * Starts collapsed on mobile (zero screenspace blockage) and expanded on desktop.
   */
  showNavOutletWindow(destination) {
    const windowEl = document.getElementById('nav-outlet-window');
    if (!windowEl || !destination || !this.isActive) return;

    windowEl.style.display = '';
    const isMobile = window.innerWidth <= 768;

    // Populate data
    const capsuleNameEl = document.getElementById('nav-capsule-name');
    const capsulePillEl = document.getElementById('nav-capsule-pill');
    const cardTitleEl = document.getElementById('nav-card-cust-name');
    const cardColorPillEl = document.getElementById('nav-card-color-pill');
    const cardTotalOutletsEl = document.getElementById('nav-card-total-outlets');
    const cardDistEl = document.getElementById('nav-card-dist-name');
    const cardTypeEl = document.getElementById('nav-card-outlet-type');
    const cardLatEl = document.getElementById('nav-card-lat');
    const cardLngEl = document.getElementById('nav-card-lng');
    const cardStatusNoteEl = document.getElementById('nav-card-status-note');

    const customerOutlets = (this.dataLoader && destination.custName)
      ? (this.dataLoader.getOutletsByCustomer(destination.custName) || [])
      : [];
    const isDropped = Boolean(destination.isDroppedPin);
    const isGlobal = Boolean(destination.isGlobalPlace || isDropped || (customerOutlets.length === 0 && !destination.distName));

    const custName = destination.custName || 'Selected Location';
    const hexColor = destination.color?.hex || '#38bdf8';
    const textContrast = destination.color?.textContrastColor || '#060911';

    if (capsuleNameEl) capsuleNameEl.textContent = custName;
    if (cardTitleEl) cardTitleEl.textContent = custName;

    const badgeText = isDropped ? 'Dropped Pin' : (isGlobal ? 'Search Place' : `${customerOutlets.length} Outlets`);

    if (capsulePillEl) {
      capsulePillEl.style.backgroundColor = hexColor;
      capsulePillEl.style.color = textContrast;
      capsulePillEl.textContent = badgeText;
    }

    if (cardColorPillEl) {
      cardColorPillEl.style.backgroundColor = hexColor;
      cardColorPillEl.style.color = textContrast;
      cardColorPillEl.textContent = badgeText;
    }

    if (cardTotalOutletsEl) {
      if (isDropped) {
        cardTotalOutletsEl.textContent = 'Custom Pin';
      } else if (isGlobal) {
        cardTotalOutletsEl.textContent = 'Worldwide Place';
      } else {
        cardTotalOutletsEl.textContent = `${customerOutlets.length} locations`;
      }
    }

    if (cardDistEl) {
      cardDistEl.textContent = destination.distName || (isDropped ? 'Dropped Location' : (isGlobal ? 'Global Location' : 'NCR Region'));
    }

    if (cardTypeEl) {
      cardTypeEl.textContent = isDropped ? 'Map Coordinates' : (isGlobal ? (destination.outletType || 'Place / Landmark') : (destination.outletType || 'Retail Outlet'));
    }

    if (cardLatEl && typeof destination.lat === 'number') {
      cardLatEl.textContent = destination.lat.toFixed(6);
    }

    if (cardLngEl && typeof destination.lng === 'number') {
      cardLngEl.textContent = destination.lng.toFixed(6);
    }

    if (cardStatusNoteEl) {
      cardStatusNoteEl.innerHTML = '<span class="status-radar-dot"></span> Active Destination';
    }

    // Activate window
    windowEl.classList.add('active');

    // On mobile, start collapsed so navigation map space is 100% open and visible
    // On desktop, start expanded (since bottom-left has ample free screenspace)
    if (isMobile) {
      windowEl.classList.add('collapsed');
      windowEl.classList.remove('expanded');
    } else {
      windowEl.classList.add('expanded');
      windowEl.classList.remove('collapsed');
    }

    this.syncNavOutletToggleBtn();
  }

  /**
   * Toggles between expanded card and collapsed capsule pill
   */
  toggleNavOutletWindow(forceExpand = null) {
    const windowEl = document.getElementById('nav-outlet-window');
    if (!windowEl || !this.isActive) return;

    const willExpand = forceExpand !== null ? Boolean(forceExpand) : windowEl.classList.contains('collapsed');

    if (willExpand) {
      windowEl.classList.remove('collapsed');
      windowEl.classList.add('expanded');
    } else {
      windowEl.classList.remove('expanded');
      windowEl.classList.add('collapsed');
    }

    this.syncNavOutletToggleBtn();
  }

  /**
   * Syncs active visual state on the HUD toggle button
   */
  syncNavOutletToggleBtn() {
    const windowEl = document.getElementById('nav-outlet-window');
    const toggleBtn = document.getElementById('btn-toggle-nav-outlet-info');
    if (toggleBtn && windowEl) {
      const isExpanded = windowEl.classList.contains('expanded');
      toggleBtn.classList.toggle('active', isExpanded);
      toggleBtn.setAttribute('aria-expanded', String(isExpanded));
      const textSpan = toggleBtn.querySelector('span');
      if (textSpan) {
        textSpan.textContent = isExpanded ? 'Hide Details' : 'Outlet Info';
      }
    }
  }

  /**
   * Hides the nav outlet window when navigation finishes
   */
  hideNavOutletWindow() {
    const windowEl = document.getElementById('nav-outlet-window');
    if (windowEl) {
      windowEl.classList.remove('active', 'expanded');
      windowEl.classList.add('collapsed');
      windowEl.style.display = 'none';
    }
    const toggleBtn = document.getElementById('btn-toggle-nav-outlet-info');
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
      const textSpan = toggleBtn.querySelector('span');
      if (textSpan) textSpan.textContent = 'Outlet Info';
    }
  }

  /**
   * Copies active destination GPS coordinates to clipboard with user feedback
   */
  copyNavDestinationCoords() {
    if (!this.destination || typeof this.destination.lat !== 'number' || typeof this.destination.lng !== 'number') {
      this.showToast('No coordinates available', 'warning');
      return;
    }

    const coordsStr = `${this.destination.lat.toFixed(6)}, ${this.destination.lng.toFixed(6)}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(coordsStr)
        .then(() => {
          this.showToast(`Copied coordinates: ${coordsStr}`, 'info');
        })
        .catch(() => {
          this.showToast(`Coordinates: ${coordsStr}`, 'info');
        });
    } else {
      this.showToast(`Coordinates: ${coordsStr}`, 'info');
    }
  }

  setNavStatus(status) {
    const el = document.getElementById('nav-instruction-text');
    if (el) el.textContent = status;
  }

  showToast(message, type = 'info') {
    this.events.dispatchEvent(new CustomEvent('toast', { detail: { message, type } }));
  }

  getManeuverSVG(maneuver) {
    switch (maneuver) {
      case 'rerouting':
      case 'recalculating':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.5" class="spin-icon"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
      case 'turn-left':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M9 6l-6 6 6 6v-4h6a5 5 0 0 1 5 5v1h2v-1a7 7 0 0 0-7-7H9V6z"/></svg>`;
      case 'turn-right':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M15 6l6 6-6 6v-4H9a5 5 0 0 0-5 5v1H2v-1a7 7 0 0 1 7-7h6V6z"/></svg>`;
      case 'turn-sharp-left':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M7 6l-5 5 5 5v-3h8a4 4 0 0 1 4 4v3h2v-3a6 6 0 0 0-6-6H7V6z"/></svg>`;
      case 'turn-sharp-right':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M17 6l5 5-5 5v-3H9a4 4 0 0 0-4 4v3H3v-3a6 6 0 0 1 6-6h8V6z"/></svg>`;
      case 'turn-slight-left':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M8 5L3 10l5 5v-3h4a6 6 0 0 1 6 6v2h2v-2a8 8 0 0 0-8-8H8V5z"/></svg>`;
      case 'turn-slight-right':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M16 5l5 5-5 5v-3h-4a6 6 0 0 0-6 6v2H4v-2a8 8 0 0 1 8-8h4V5z"/></svg>`;
      case 'u-turn':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M6 9a6 6 0 0 1 12 0v9h-2V9a4 4 0 0 0-8 0v4H6V9zm-3 4l4 4 4-4H3z"/></svg>`;
      case 'roundabout':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V14h-2v2.93A8 8 0 0 1 4.07 13H7v-2H4.07A8 8 0 0 1 11 4.07V7h2V4.07A8 8 0 0 1 19.93 11H17v2h2.93A8 8 0 0 1 13 16.93z"/></svg>`;
      case 'destination':
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`;
      default:
        return `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M12 2L4.5 9.5l1.4 1.4L11 5.8V22h2V5.8l5.1 5.1 1.4-1.4L12 2z"/></svg>`;
    }
  }
}
