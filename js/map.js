/**
 * Map Manager
 * Handles Leaflet map initialization, high-performance marker clustering,
 * deterministic SVG pin rendering, navigation route overlays, and destination highlights.
 */

import { CONFIG } from '../config/config.js';

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class MapManager {
  constructor(containerId = 'map') {
    this.containerId = containerId;
    this.map = null;
    this.clusterGroup = null;
    this.markerMap = new Map(); // outletId -> L.Marker
    this.currentTileLayer = null;
    this.routeLayers = []; // Primary and alternative polyline layers
    this.userLocationMarker = null;
    this.userAccuracyCircle = null;
    this.destinationMarker = null;
    this.destinationPulseLayer = null;
    this.customOriginMarker = null;
    this.activeOutletId = null;
    this.dimmedCustomers = false;
    this.events = new EventTarget();
  }

  /**
   * Initialize Leaflet map and marker clustering
   * @param {Array<number>} initialCenter [lat, lng]
   * @param {number} initialZoom
   */
  initMap(initialCenter = [28.4595, 77.0266], initialZoom = 11) {
    if (this.map) return;

    this.map = L.map(this.containerId, {
      center: initialCenter,
      zoom: initialZoom,
      zoomControl: false, // We will place zoom control in a custom position
      preferCanvas: true,
      wheelDebounceTime: 40
    });

    // Add zoom control to top-right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Add default tile layer
    this.setTileProvider(CONFIG.DEFAULT_TILE_PROVIDER);

    // Initialize high-performance MarkerClusterGroup
    this.clusterGroup = L.markerClusterGroup({
      maxClusterRadius: CONFIG.CLUSTERING.maxClusterRadius,
      spiderfyOnMaxZoom: CONFIG.CLUSTERING.spiderfyOnMaxZoom,
      showCoverageOnHover: CONFIG.CLUSTERING.showCoverageOnHover,
      zoomToBoundsOnClick: CONFIG.CLUSTERING.zoomToBoundsOnClick,
      disableClusteringAtZoom: CONFIG.CLUSTERING.disableClusteringAtZoom,
      chunkedLoading: CONFIG.CLUSTERING.chunkedLoading,
      chunkInterval: CONFIG.CLUSTERING.chunkInterval,
      chunkDelay: CONFIG.CLUSTERING.chunkDelay,
      iconCreateFunction: (cluster) => this.createClusterIcon(cluster)
    });

    this.map.addLayer(this.clusterGroup);

    this.clusterGroup.on('clusterclick', () => {
      this._markerClickedJustNow = true;
      setTimeout(() => { this._markerClickedJustNow = false; }, 300);
    });

    // Dispatch map move/zoom events for live visible stats
    this.map.on('moveend zoomend', () => {
      this.events.dispatchEvent(new CustomEvent('viewportChange'));
    });

    console.info('[MapManager] Leaflet Map and ClusterGroup initialized successfully.');
  }

  /**
   * Fits map viewport to specified lat/lng bounding box
   * @param {Array} bounds [[minLat, minLng], [maxLat, maxLng]]
   * @param {Array<number>} padding
   */
  fitBounds(bounds, padding = [30, 30]) {
    if (this.map && bounds) {
      if (!this.initialBounds) {
        this.initialBounds = bounds;
      }
      this.map.fitBounds(bounds, { padding });
    }
  }

  /**
   * Switches tile provider dynamically (TomTom Dark, TomTom Day, CARTO Dark, Voyager, Positron)
   * @param {string} providerKey 
   */
  setTileProvider(providerKey) {
    const provider = CONFIG.TILE_PROVIDERS[providerKey] || CONFIG.TILE_PROVIDERS[CONFIG.DEFAULT_TILE_PROVIDER] || CONFIG.TILE_PROVIDERS.dark;
    if (this.currentTileLayer) {
      this.map.removeLayer(this.currentTileLayer);
    }

    const tomtomKey = CONFIG.getTomTomApiKey();
    const basemapKey = CONFIG.getBasemapApiKey();
    const tileUrl = typeof provider.getUrl === 'function' ? provider.getUrl(tomtomKey, basemapKey) : provider.url;

    this.currentTileLayer = L.tileLayer(tileUrl, {
      maxZoom: provider.maxZoom || 20,
      attribution: provider.attribution || '&copy; OpenStreetMap',
      subdomains: provider.subdomains || 'abc'
    }).addTo(this.map);
  }


  /**
   * Generates a custom HTML cluster icon showing count with modern badge styling
   */
  createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    let sizeClass = 'cluster-small';
    let size = 38;

    if (count > 500) {
      sizeClass = 'cluster-xlarge';
      size = 54;
    } else if (count > 100) {
      sizeClass = 'cluster-large';
      size = 48;
    } else if (count > 25) {
      sizeClass = 'cluster-medium';
      size = 42;
    }

    const html = `
      <div class="custom-cluster-badge ${sizeClass}">
        <span class="cluster-count">${count.toLocaleString()}</span>
      </div>
    `;

    return L.divIcon({
      html: html,
      className: 'custom-cluster-icon',
      iconSize: L.point(size, size)
    });
  }

  /**
   * Generates custom SVG pin icon for an outlet with its customer color
   * @param {object} colorObj { hex, hsl, rgb, textContrastColor }
   * @param {boolean} isHighlighted
   * @returns {L.DivIcon}
   */
  createOutletIcon(colorObj, isHighlighted = false) {
    const hex = colorObj ? colorObj.hex : '#3b82f6';
    const scale = isHighlighted ? 1.3 : 1.0;
    const width = Math.round(22 * scale);
    const height = Math.round(30 * scale);

    const svg = `
      <div class="outlet-marker-wrapper ${isHighlighted ? 'highlighted' : ''}" style="width: ${width}px; height: ${height}px;">
        <svg viewBox="0 0 24 32" width="${width}" height="${height}" fill="none" xmlns="http://www.w3.org/2000/svg" class="pin-svg">
          <filter id="shadow-${hex.replace('#','')}" x="-20%" y="-10%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.5"/>
          </filter>
          <path d="M12 0C5.37258 0 0 5.37258 0 12C0 20.25 12 32 12 32C12 32 24 20.25 24 12C24 5.37258 18.6274 0 12 0Z" 
                fill="${hex}" 
                filter="url(#shadow-${hex.replace('#','')})"/>
          <circle cx="12" cy="12" r="5" fill="#FFFFFF"/>
          <circle cx="12" cy="12" r="2.5" fill="${hex}"/>
        </svg>
      </div>
    `;

    return L.divIcon({
      html: svg,
      className: 'outlet-div-icon',
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
      popupAnchor: [0, -height + 4]
    });
  }

  /**
   * Populates the map with all loaded outlet markers
   * @param {Array<object>} outlets 
   */
  loadOutlets(outlets) {
    this.clusterGroup.clearLayers();
    this.markerMap.clear();

    const markers = [];

    for (const outlet of outlets) {
      const icon = this.createOutletIcon(outlet.color);
      const marker = L.marker([outlet.lat, outlet.lng], {
        icon: icon,
        title: `${outlet.custName} (${outlet.distName})`,
        riseOnHover: true
      });

      marker.outletData = outlet;

      // Attach click handler
      marker.on('click', (e) => {
        if (e && e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
        this._markerClickedJustNow = true;
        setTimeout(() => { this._markerClickedJustNow = false; }, 300);
        this.selectOutlet(outlet, false);
      });

      // Bind concise tooltip on hover
      marker.bindTooltip(`
        <div class="map-tooltip">
          <div class="tooltip-header" style="border-left-color: ${escapeHtml(outlet.color?.hex || '#3b82f6')}">${escapeHtml(outlet.custName)}</div>
          <div class="tooltip-sub">${escapeHtml(outlet.distName)} &bull; ${escapeHtml(outlet.outletType)}</div>
        </div>
      `, {
        direction: 'top',
        offset: [0, -28],
        opacity: 0.95
      });

      this.markerMap.set(outlet.id, marker);
      markers.push(marker);
    }

    // Add all markers to the cluster group in a single performant chunked batch
    this.clusterGroup.addLayers(markers);

    console.info(`[MapManager] Successfully added ${markers.length} markers to the cluster layer.`);
  }

  /**
   * Automatically fit map viewport to all valid outlet coordinates
   * @param {Array<Array<number>>} bounds [[minLat, minLng], [maxLat, maxLng]]
   */
  fitBounds(bounds) {
    if (bounds && this.map) {
      this.map.fitBounds(bounds, {
        padding: [40, 40],
        maxZoom: 14,
        animate: true
      });
    }
  }

  /**
   * Programmatically selects an outlet, centers on it, and emits event
   * @param {object} outlet 
   * @param {boolean} zoomTo 
   */
  selectOutlet(outlet, zoomTo = true) {
    this.activeOutletId = outlet.id;

    if (zoomTo && this.map) {
      this.map.setView([outlet.lat, outlet.lng], Math.max(this.map.getZoom(), 15), {
        animate: true,
        duration: 0.8
      });
    }

    // Highlight marker icon or drop a global search destination pin
    const marker = this.markerMap.get(outlet.id);
    if (marker) {
      marker.setIcon(this.createOutletIcon(outlet.color, true));
      // Revert previous marker icon when another is selected
      if (this._lastHighlightedMarker && this._lastHighlightedMarker !== marker) {
        this._lastHighlightedMarker.setIcon(this.createOutletIcon(this._lastHighlightedMarker.outletData.color, false));
      }
      this._lastHighlightedMarker = marker;
      if (this._searchPlaceMarker && this.map) {
        this.map.removeLayer(this._searchPlaceMarker);
        this._searchPlaceMarker = null;
      }
    } else {
      // It is a searched global place, address, or landmark
      if (this._searchPlaceMarker && this.map) {
        this.map.removeLayer(this._searchPlaceMarker);
      }
      const customPin = L.divIcon({
        className: 'search-destination-pin',
        html: `
          <div class="search-pin-wrapper">
            <div class="search-pin-core"><span>📍</span></div>
            <div class="search-pin-pulse"></div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 36]
      });
      this._searchPlaceMarker = L.marker([outlet.lat, outlet.lng], {
        icon: customPin,
        zIndexOffset: 1500
      }).addTo(this.map);

      this._searchPlaceMarker.bindTooltip(`
        <div class="map-tooltip">
          <div class="tooltip-header" style="border-left-color: ${escapeHtml(outlet.color?.hex || '#00f0ff')}">${escapeHtml(outlet.custName)}</div>
          <div class="tooltip-sub">${escapeHtml(outlet.distName || 'Searched Destination')} &bull; ${escapeHtml(outlet.outletType || 'Place')}</div>
        </div>
      `, { direction: 'top', offset: [0, -32], opacity: 0.95 }).openTooltip();
    }

    // Dispatch event for UI popup/card
    this.events.dispatchEvent(new CustomEvent('outletSelected', { detail: outlet }));
  }

  /**
   * Drops or updates custom starting location marker on the map
   * @param {object} origin { lat, lng, name }
   */
  setCustomOriginMarker(origin) {
    this.clearCustomOriginMarker();

    if (!origin || typeof origin.lat !== 'number' || typeof origin.lng !== 'number' || !this.map) return;

    const originPin = L.divIcon({
      className: 'custom-origin-pin',
      html: `
        <div class="custom-origin-wrapper">
          <div class="custom-origin-dot"><span>A</span></div>
          <div class="custom-origin-pulse"></div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    this._customOriginMarker = L.marker([origin.lat, origin.lng], {
      icon: originPin,
      zIndexOffset: 2500
    }).addTo(this.map);

    this._customOriginMarker.bindTooltip(`Starting point: ${escapeHtml(origin.name || 'Custom Origin')}`, {
      direction: 'top',
      offset: [0, -16],
      opacity: 0.95
    });
  }

  /**
   * Removes custom starting location marker from map
   */
  clearCustomOriginMarker() {
    if (this._customOriginMarker && this.map) {
      this.map.removeLayer(this._customOriginMarker);
      this._customOriginMarker = null;
    }
  }

  /**
   * Filter visible markers by an array of matched outlet IDs
   * @param {Set<number> | null} allowedIds Set of outlet IDs or null to show all
   */
  filterMarkers(allowedIds) {
    this.clusterGroup.clearLayers();

    if (!allowedIds) {
      // Restore all markers
      const allMarkers = Array.from(this.markerMap.values());
      this.clusterGroup.addLayers(allMarkers);
      return;
    }

    const filtered = [];
    for (const [id, marker] of this.markerMap.entries()) {
      if (allowedIds.has(id)) {
        filtered.push(marker);
      }
    }

    this.clusterGroup.addLayers(filtered);
    this.events.dispatchEvent(new CustomEvent('viewportChange'));
  }

  /**
   * Highlights all outlets belonging to a customer, softly dimming other markers without deleting them
   * @param {string} customerName 
   */
  highlightCustomer(customerName) {
    this.dimmedCustomers = true;
    for (const [id, marker] of this.markerMap.entries()) {
      const isMatch = marker.outletData.custName.toUpperCase() === customerName.toUpperCase();
      const el = marker.getElement();
      if (el) {
        if (isMatch) {
          el.style.opacity = '1';
          el.style.filter = 'drop-shadow(0 0 8px #ffffff)';
          el.style.zIndex = '1000';
        } else {
          el.style.opacity = '0.22';
          el.style.filter = 'grayscale(60%)';
          el.style.zIndex = '1';
        }
      }
    }
  }

  /**
   * Resets all marker opacities and filters
   */
  resetCustomerHighlight() {
    this.dimmedCustomers = false;
    for (const [id, marker] of this.markerMap.entries()) {
      const el = marker.getElement();
      if (el) {
        el.style.opacity = '1';
        el.style.filter = 'none';
        el.style.zIndex = '';
      }
    }
  }

  /**
   * Emphasizes the destination outlet during navigation with a pulsing animated beacon
   * while keeping ALL OTHER outlets visible!
   * @param {object} destinationOutlet 
   */
  setDestinationHighlight(destinationOutlet) {
    this.clearDestinationHighlight();

    if (!destinationOutlet) return;

    const latLng = [destinationOutlet.lat, destinationOutlet.lng];

    // Pulsing glowing ring layer
    const pulseIcon = L.divIcon({
      html: `
        <div class="destination-pulse-beacon">
          <div class="pulse-ring"></div>
          <div class="pulse-ring delay-1"></div>
          <div class="pulse-center-pin" style="background-color: ${destinationOutlet.color.hex}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="#ffffff">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
        </div>
      `,
      className: 'destination-pulse-icon',
      iconSize: [60, 60],
      iconAnchor: [30, 30]
    });

    this.destinationPulseLayer = L.marker(latLng, {
      icon: pulseIcon,
      zIndexOffset: 2000
    }).addTo(this.map);
  }

  /**
   * Removes destination pulsing highlight
   */
  clearDestinationHighlight() {
    if (this.destinationPulseLayer) {
      this.map.removeLayer(this.destinationPulseLayer);
      this.destinationPulseLayer = null;
    }
  }

  /**
   * Updates or creates the live User Location marker on the map
   * @param {object} pos { lat, lng, heading, accuracy }
   */
  updateUserLocation(pos) {
    if (!pos || !pos.lat || !pos.lng) return;

    const latLng = [pos.lat, pos.lng];

    if (!this.userLocationMarker) {
      const userIcon = L.divIcon({
        html: `
          <div class="user-gps-marker">
            <div class="gps-pulse"></div>
            <div class="gps-dot">
              <div class="gps-heading-arrow" id="user-heading-arrow"></div>
            </div>
          </div>
        `,
        className: 'user-gps-icon',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      this.userLocationMarker = L.marker(latLng, {
        icon: userIcon,
        zIndexOffset: 3000
      }).addTo(this.map);

      this.userAccuracyCircle = L.circle(latLng, {
        radius: pos.accuracy || 20,
        color: '#38bdf8',
        weight: 1,
        fillColor: '#38bdf8',
        fillOpacity: 0.12
      }).addTo(this.map);
    } else {
      this.userLocationMarker.setLatLng(latLng);
      if (this.userAccuracyCircle) {
        this.userAccuracyCircle.setLatLng(latLng);
        if (pos.accuracy) {
          this.userAccuracyCircle.setRadius(pos.accuracy);
        }
      }
    }

    // Update heading rotation if available
    const arrow = document.getElementById('user-heading-arrow');
    if (arrow) {
      if (pos.heading !== undefined && pos.heading !== null && !isNaN(pos.heading)) {
        arrow.style.display = 'block';
        arrow.style.transform = `rotate(${pos.heading}deg)`;
      } else {
        arrow.style.display = 'none';
      }
    }
  }

  /**
   * Renders the primary navigation route polyline and any alternative routes
   * @param {RouteResult} primaryRoute 
   * @param {Array<RouteResult>} alternativeRoutes 
   */
  displayRoute(primaryRoute, alternativeRoutes = []) {
    this.clearRoutes();

    if (!primaryRoute || !primaryRoute.coordinates || primaryRoute.coordinates.length === 0) {
      return;
    }

    // 1. Render alternative routes first (in background)
    if (alternativeRoutes && alternativeRoutes.length > 0) {
      alternativeRoutes.forEach((altRoute, idx) => {
        const altGlow = L.polyline(altRoute.coordinates, {
          color: '#475569',
          weight: 7,
          opacity: 0.5,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(this.map);

        const altLine = L.polyline(altRoute.coordinates, {
          color: '#94a3b8',
          weight: 4,
          opacity: 0.85,
          dashArray: '8, 8',
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(this.map);

        // Click to make this alternative the active route
        altLine.on('click', () => {
          this.events.dispatchEvent(new CustomEvent('selectAlternativeRoute', { detail: altRoute }));
        });
        altGlow.on('click', () => {
          this.events.dispatchEvent(new CustomEvent('selectAlternativeRoute', { detail: altRoute }));
        });

        this.routeLayers.push(altGlow, altLine);
      });
    }

    // 2. Render primary recommended route with dynamic glow
    const casing = L.polyline(primaryRoute.coordinates, {
      color: '#0f172a',
      weight: 10,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    const glow = L.polyline(primaryRoute.coordinates, {
      color: '#0284c7',
      weight: 8,
      opacity: 0.7,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    const mainLine = L.polyline(primaryRoute.coordinates, {
      color: '#38bdf8',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(this.map);

    this.routeLayers.push(casing, glow, mainLine);

    // Zoom and pan to fit entire route with padding
    const routeBounds = L.latLngBounds(primaryRoute.coordinates);
    this.map.fitBounds(routeBounds, {
      padding: [80, 80],
      maxZoom: 16,
      animate: true
    });
  }

  /**
   * Clears route polylines
   */
  clearRoutes() {
    for (const layer of this.routeLayers) {
      if (this.map) {
        this.map.removeLayer(layer);
      }
    }
    this.routeLayers = [];
  }

  /**
   * Cleans up all navigation overlays (route, destination pulse, etc.)
   * IMPORTANT: Retains all outlet markers and the user's location!
   */
  endNavigation() {
    this.clearRoutes();
    this.clearDestinationHighlight();
    this.clearCustomOriginMarker();
    this.resetCustomerHighlight();
  }

  /**
   * Triggers Leaflet recalculation of container dimensions
   * Essential after resizing, opening, or collapsing the sidebar drawer
   */
  invalidateSize(animate = false) {
    if (this.map) {
      this.map.invalidateSize({ animate });
    }
  }

  /**
   * Centers and zooms the map smoothly to the user's GPS location marker
   * @param {number} zoom 
   */
  recenterUserLocation(zoom = 16) {
    if (!this.map || !this.userLocationMarker) return false;
    const latLng = this.userLocationMarker.getLatLng();
    this.map.flyTo(latLng, zoom, {
      animate: true,
      duration: 1.0
    });
    return true;
  }

  /**
   * Resets map bounds to show all loaded outlets in the dataset
   */
  fitBoundsToAllOutlets() {
    if (!this.map) return;
    if (this.initialBounds) {
      this.fitBounds(this.initialBounds);
      return;
    }
    const markers = Array.from(this.markerMap.values());
    if (markers.length > 0) {
      const group = L.featureGroup(markers);
      this.map.fitBounds(group.getBounds(), { padding: [40, 40] });
    }
  }

  /**
   * Gets the count of currently visible outlet markers in the map's viewport
   * @returns {number}
   */
  getVisibleOutletsCount() {
    if (!this.map) return 0;
    const bounds = this.map.getBounds();
    let count = 0;
    for (const marker of this.markerMap.values()) {
      if (bounds.contains(marker.getLatLng())) {
        count++;
      }
    }
    return count;
  }

  /**
   * Places or updates custom origin starting point marker ("A" badge) on map
   * @param {object} origin { lat, lng, name }
   */
  setCustomOriginMarker(origin) {
    if (!this.map || !origin || typeof origin.lat !== 'number' || typeof origin.lng !== 'number') return;
    this.clearCustomOriginMarker();

    const originIcon = L.divIcon({
      className: 'custom-origin-marker',
      html: `
        <div class="custom-origin-wrapper">
          <div class="custom-origin-pulse"></div>
          <div class="custom-origin-dot" title="Starting Location: ${origin.name || 'Origin'}">A</div>
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    this.customOriginMarker = L.marker([origin.lat, origin.lng], {
      icon: originIcon,
      zIndexOffset: 1500
    }).addTo(this.map);

    this.customOriginMarker.bindPopup(`
      <div style="font-family: inherit; font-size: 0.8rem; padding: 2px;">
        <strong style="color: #0284c7;">Starting Point (A)</strong><br>
        <span>${escapeHtml(origin.name || `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`)}</span>
      </div>
    `);
  }

  /**
   * Removes custom origin marker from the map
   */
  clearCustomOriginMarker() {
    if (this.customOriginMarker && this.map) {
      this.map.removeLayer(this.customOriginMarker);
      this.customOriginMarker = null;
    }
  }
}

export const mapManager = new MapManager();
