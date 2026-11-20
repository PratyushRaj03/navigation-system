/**
 * UI Orchestrator
 * Manages Legend, Dashboard Statistics, Outlet Detail Cards, Modals,
 * Floating Map Controls, Responsive Drawers, Location Permission Flow,
 * Settings, and Toast Notifications.
 */

import { CONFIG } from '../config/config.js';
import { routingService } from './routing.js';

export class UIManager {
  constructor(dataLoader, mapManager, navigationController) {
    this.dataLoader = dataLoader;
    this.mapManager = mapManager;
    this.navController = navigationController;
    this.activeCustomerFilter = null;
    this.toastContainer = null;
    this.locationStatus = 'prompt'; // 'prompt' | 'active' | 'denied' | 'locating'
    this.customOrigin = null; // null means default: user's GPS/current location
    this.isPickingOriginOnMap = false;
    this.currentOutlet = null;
    this._originSearchTimer = null;
  }

  /**
   * Initializes all UI panels, modals, and event listeners
   */
  init() {
    this.toastContainer = document.getElementById('toast-container');
    this.setupThemeEngine();
    this.setupKeyboardShortcuts();
    this.setupSidebarToggle();
    this.setupCollapsibleSections();
    this.setupFloatingControls();
    this.setupLocationModals();
    this.setupExecutiveSettings();
    this.setupStatsDisplay();
    this.setupLegend();
    this.setupOutletDetailCard();
    this.setupRouteWaypoints();
    this.setupWindowResizeHandler();

    // Update visible outlets count on map pan/zoom
    this.mapManager.events.addEventListener('viewportChange', () => {
      this.updateViewportStats();
    });

    // Listen for outlet selection from map or search
    this.mapManager.events.addEventListener('outletSelected', (e) => {
      if (this.navController && this.navController.isActive) return;
      this.showOutletDetails(e.detail);
      // On mobile, auto-close sidebar drawer when outlet is picked
      if (window.innerWidth <= 768) {
        this.closeMobileSidebar();
      }
    });

    // Listen to toasts from navigation
    this.navController.events.addEventListener('toast', (e) => {
      this.showToast(e.detail.message, e.detail.type);
    });
  }

  /**
   * Setup window resize handler to keep Leaflet map responsive
   */
  setupWindowResizeHandler() {
    const updateClearance = () => {
      if (window.innerWidth <= 768) {
        let toolbarHeight = 0;
        if (window.visualViewport) {
          toolbarHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
        }
        const clearance = Math.max(76, toolbarHeight + 68);
        document.documentElement.style.setProperty('--mobile-bottom-clearance', `${clearance}px`);
      }
    };

    updateClearance();
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      updateClearance();
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.mapManager.invalidateSize(true);
      }, 150);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateClearance);
    }
  }

  /**
   * Setup Sidebar collapsible drawer for mobile and desktop
   */
  setupSidebarToggle() {
    const sidebar = document.getElementById('app-sidebar');
    const toggleBtn = document.getElementById('btn-sidebar-toggle');
    const mobileMenuBtn = document.getElementById('btn-mobile-menu');
    const backdrop = document.getElementById('sidebar-backdrop');

    const toggleSidebar = () => {
      if (!sidebar) return;
      const isMobile = window.innerWidth <= 768;

      if (isMobile) {
        const isOpen = sidebar.classList.toggle('mobile-open');
        if (backdrop) {
          backdrop.classList.toggle('visible', isOpen);
        }
      } else {
        sidebar.classList.toggle('collapsed');
      }

      // Smoothly re-evaluate map size
      setTimeout(() => this.mapManager.invalidateSize(true), 320);
    };

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebar();
      });
    }

    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebar();
      });
    }

    if (backdrop) {
      backdrop.addEventListener('click', () => {
        this.closeMobileSidebar();
      });
    }
  }

  closeMobileSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (backdrop) backdrop.classList.remove('visible');
    setTimeout(() => this.mapManager.invalidateSize(true), 320);
  }

  /**
   * Setup Accordion Collapsible Sections (Filters & Legend)
   */
  setupCollapsibleSections() {
    const sections = document.querySelectorAll('.collapsible-section');
    sections.forEach(sec => {
      const header = sec.querySelector('.section-header');
      if (header) {
        header.addEventListener('click', () => {
          sec.classList.toggle('collapsed');
        });
      }
    });
  }

  /**
   * Setup Floating Map Controls (Locate Me, Status, Reset View, Settings)
   */
  setupFloatingControls() {
    const locateBtn = document.getElementById('btn-locate-me');
    const resetBtn = document.getElementById('btn-reset-view');
    const statusBtn = document.getElementById('btn-location-status');
    const floatSettingsBtn = document.getElementById('btn-open-settings-floating');

    if (locateBtn) {
      locateBtn.addEventListener('click', async () => {
        locateBtn.classList.add('active');
        this.updateLocationStatus('locating');
        const res = await this.navController.requestUserLocation(true);
        locateBtn.classList.remove('active');

        if (res.success) {
          this.updateLocationStatus('active');
          this.showToast('Centered to your live GPS position', 'success');
        } else {
          if (res.error && res.error.code === 1) {
            this.updateLocationStatus('denied');
            this.showLocationHelpModal();
          } else {
            this.updateLocationStatus('prompt');
            this.showToast('Could not acquire GPS position. Check location settings.', 'warning');
          }
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.mapManager.fitBoundsToAllOutlets();
        this.showToast('Map view reset to show all outlets', 'info');
      });
    }

    if (statusBtn) {
      statusBtn.addEventListener('click', () => {
        if (this.locationStatus === 'denied') {
          this.showLocationHelpModal();
        } else if (this.locationStatus === 'active') {
          this.mapManager.recenterUserLocation(16);
          this.showToast('GPS active. Centered to your location.', 'success');
        } else {
          this.showLocationPromptModal();
        }
      });
    }

    if (floatSettingsBtn) {
      floatSettingsBtn.addEventListener('click', () => {
        this.openSettingsModal();
      });
    }
  }

  /**
   * Updates Location Status Button Pill state & label
   * @param {'prompt' | 'active' | 'denied' | 'locating'} status 
   */
  updateLocationStatus(status) {
    this.locationStatus = status;
    const btn = document.getElementById('btn-location-status');
    const lbl = document.getElementById('location-status-label');
    if (!btn || !lbl) return;

    btn.classList.remove('prompt', 'active', 'denied', 'locating');
    btn.classList.add(status);

    if (status === 'active') {
      lbl.textContent = 'GPS: Active';
      btn.title = 'Live GPS active. Click to center.';
    } else if (status === 'denied') {
      lbl.textContent = 'GPS: Blocked ⚠️';
      btn.title = 'Location blocked. Click to see how to enable.';
    } else if (status === 'locating') {
      lbl.textContent = 'GPS: Locating...';
      btn.title = 'Acquiring GPS fix...';
    } else {
      lbl.textContent = 'Enable GPS 📍';
      btn.title = 'Click to enable live GPS location.';
    }
  }

  /**
   * Proactively checks browser location permissions at startup
   * If permission has not been granted or asked, presents the startup modal.
   */
  async checkInitialLocationPermission() {
    const savedPref = localStorage.getItem('fleetnav_location_preference');

    // 1. Try modern Permissions API if available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'geolocation' });
        console.info('[UI] Geolocation permission status at startup:', status.state);

        if (status.state === 'granted') {
          this.updateLocationStatus('active');
          // Quietly obtain initial coordinates without forcibly shifting user's initial overview
          this.navController.requestUserLocation(false);
        } else if (status.state === 'prompt') {
          this.updateLocationStatus('prompt');
          // If user hasn't explicitly chosen to skip permanently, ask on startup
          if (savedPref !== 'skipped') {
            this.showLocationPromptModal();
          }
        } else if (status.state === 'denied') {
          this.updateLocationStatus('denied');
        }

        // Listen for user changing permission in browser settings
        status.onchange = () => {
          console.info('[UI] Geolocation permission changed to:', status.state);
          if (status.state === 'granted') {
            this.updateLocationStatus('active');
            this.navController.requestUserLocation(false);
            this.showToast('Location permission granted!', 'success');
          } else if (status.state === 'denied') {
            this.updateLocationStatus('denied');
          } else {
            this.updateLocationStatus('prompt');
          }
        };

        return;
      } catch (e) {
        console.warn('[UI] Permissions query error:', e);
      }
    }

    // Fallback if Permissions API not supported
    if (savedPref !== 'skipped') {
      this.showLocationPromptModal();
    } else {
      this.updateLocationStatus('prompt');
    }
  }

  /**
   * Setup Location Permission Prompt & Help Modals
   */
  setupLocationModals() {
    // 1. Startup Permission Prompt Modal
    const promptModal = document.getElementById('location-prompt-modal');
    const allowBtn = document.getElementById('btn-location-allow');
    const skipBtn = document.getElementById('btn-location-skip');
    const rememberChk = document.getElementById('chk-location-remember');

    if (allowBtn) {
      allowBtn.addEventListener('click', async () => {
        this.hideLocationPromptModal();
        this.updateLocationStatus('locating');
        this.showToast('Acquiring live location...', 'info');

        const res = await this.navController.requestUserLocation(true);
        if (res.success) {
          if (rememberChk && rememberChk.checked) {
            localStorage.setItem('fleetnav_location_preference', 'granted');
          }
          this.updateLocationStatus('active');
          this.showToast('Location enabled! Live GPS marker displayed.', 'success');
        } else {
          if (res.error && res.error.code === 1) {
            this.updateLocationStatus('denied');
            this.showLocationHelpModal();
          } else {
            this.updateLocationStatus('prompt');
            this.showToast('Location acquisition timed out. You can retry anytime via the GPS button.', 'warning');
          }
        }
      });
    }

    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        this.hideLocationPromptModal();
        if (rememberChk && rememberChk.checked) {
          localStorage.setItem('fleetnav_location_preference', 'skipped');
        }
        this.updateLocationStatus('prompt');
        this.showToast('Browsing outlets with default region. Click GPS button anytime to enable.', 'info');
      });
    }

    // 2. Location Blocked Help Modal
    const helpModal = document.getElementById('location-help-modal');
    const closeHelpBtn = document.getElementById('btn-close-location-help');
    const dismissHelpBtn = document.getElementById('btn-dismiss-location-help');
    const retryBtn = document.getElementById('btn-location-retry');

    if (closeHelpBtn) {
      closeHelpBtn.addEventListener('click', () => this.hideLocationHelpModal());
    }

    if (dismissHelpBtn) {
      dismissHelpBtn.addEventListener('click', () => this.hideLocationHelpModal());
    }

    if (retryBtn) {
      retryBtn.addEventListener('click', async () => {
        retryBtn.textContent = 'Checking...';
        const res = await this.navController.requestUserLocation(true);
        retryBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          <span>Re-check GPS Permission</span>
        `;

        if (res.success) {
          this.hideLocationHelpModal();
          this.updateLocationStatus('active');
          this.showToast('Location access unblocked! Showing your position.', 'success');
        } else {
          this.showToast('Location still blocked. Please allow location in browser site settings and retry.', 'warning');
        }
      });
    }
  }

  showLocationPromptModal() {
    const modal = document.getElementById('location-prompt-modal');
    if (modal) modal.classList.add('visible');
  }

  hideLocationPromptModal() {
    const modal = document.getElementById('location-prompt-modal');
    if (modal) modal.classList.remove('visible');
  }

  showLocationHelpModal() {
    const modal = document.getElementById('location-help-modal');
    if (modal) modal.classList.add('visible');
  }

  hideLocationHelpModal() {
    const modal = document.getElementById('location-help-modal');
    if (modal) modal.classList.remove('visible');
  }

  /**
   * Setup and update dashboard statistics panel
   */
  setupStatsDisplay() {
    this.updateStatsValues();
  }

  updateStatsValues() {
    const totalEl = document.getElementById('stat-total-outlets');
    const custsEl = document.getElementById('stat-total-customers');
    const distsEl = document.getElementById('stat-total-districts');
    const visibleEl = document.getElementById('stat-visible-outlets');

    const stats = this.dataLoader.stats;

    if (totalEl) totalEl.textContent = (stats.validOutlets || 0).toLocaleString();
    if (custsEl) custsEl.textContent = (stats.uniqueCustomersCount || 0).toLocaleString();
    if (distsEl) distsEl.textContent = (stats.uniqueDistrictsCount || 0).toLocaleString();
    if (visibleEl) visibleEl.textContent = (stats.validOutlets || 0).toLocaleString();
  }

  updateViewportStats() {
    const visibleEl = document.getElementById('stat-visible-outlets');
    if (visibleEl) {
      const visibleCount = this.mapManager.getVisibleOutletsCount();
      visibleEl.textContent = visibleCount.toLocaleString();
    }
  }

  /**
   * Setup interactive collapsible Customer Legend
   */
  setupLegend() {
    const legendContainer = document.getElementById('legend-customer-list');
    const legendSearch = document.getElementById('legend-search-input');
    const legendSortBtn = document.getElementById('btn-legend-sort');
    const showAllBtn = document.getElementById('btn-legend-show-all');

    let currentSort = 'count'; // 'count' or 'name'

    const renderLegend = (filterText = '') => {
      if (!legendContainer) return;

      const customers = this.dataLoader.getCustomersSummary(currentSort);
      const query = filterText.trim().toLowerCase();

      const filtered = query 
        ? customers.filter(c => c.name.toLowerCase().includes(query)) 
        : customers;

      if (filtered.length === 0) {
        legendContainer.innerHTML = '<div class="legend-empty">No customers found</div>';
        return;
      }

      legendContainer.innerHTML = filtered.map(c => {
        const isSelected = this.activeCustomerFilter === c.name;
        return `
          <div class="legend-item ${isSelected ? 'active' : ''}" data-customer="${this.escapeHtml(c.name)}">
            <div class="legend-color-dot" style="background-color: ${c.color.hex}"></div>
            <div class="legend-customer-name" title="${this.escapeHtml(c.displayName)} (${this.escapeHtml(c.districtsFormatted)})">${this.escapeHtml(c.displayName)}</div>
            <div class="legend-outlet-count">${c.count} ${c.count === 1 ? 'outlet' : 'outlets'} • ${this.escapeHtml(c.districtsFormatted)}</div>
          </div>
        `;
      }).join('');

      // Attach click events
      legendContainer.querySelectorAll('.legend-item').forEach(el => {
        el.addEventListener('click', () => {
          const custName = el.dataset.customer;
          this.handleCustomerLegendClick(custName);
          // On mobile, auto close sidebar to inspect outlets
          if (window.innerWidth <= 768) {
            this.closeMobileSidebar();
          }
        });
      });
    };

    renderLegend();

    if (legendSearch) {
      legendSearch.addEventListener('input', (e) => {
        renderLegend(e.target.value);
      });
    }

    if (legendSortBtn) {
      legendSortBtn.addEventListener('click', () => {
        currentSort = currentSort === 'count' ? 'name' : 'count';
        legendSortBtn.innerHTML = currentSort === 'count' ? '🔢 By Count' : '🔤 By Name';
        renderLegend(legendSearch ? legendSearch.value : '');
      });
    }

    if (showAllBtn) {
      showAllBtn.addEventListener('click', () => {
        this.activeCustomerFilter = null;
        this.mapManager.resetCustomerHighlight();
        document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
        this.showToast('Restored all customer markers', 'info');
      });
    }
  }

  /**
   * Handle clicking a customer in the legend:
   * Highlights that customer's outlets, softly dims other markers without deleting them
   */
  handleCustomerLegendClick(customerName) {
    if (this.activeCustomerFilter === customerName) {
      // Toggle off
      this.activeCustomerFilter = null;
      this.mapManager.resetCustomerHighlight();
      document.querySelectorAll('.legend-item').forEach(i => i.classList.remove('active'));
      return;
    }

    this.activeCustomerFilter = customerName;
    document.querySelectorAll('.legend-item').forEach(i => {
      i.classList.toggle('active', i.dataset.customer === customerName);
    });

    // Dim others on map while highlighting selected customer
    this.mapManager.highlightCustomer(customerName);

    // Zoom to this customer's outlets
    const outlets = this.dataLoader.getOutletsByCustomer(customerName);
    if (outlets.length > 0) {
      if (outlets.length === 1) {
        this.mapManager.selectOutlet(outlets[0], true);
      } else {
        const lats = outlets.map(o => o.lat);
        const lngs = outlets.map(o => o.lng);
        const bounds = [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        ];
        this.mapManager.fitBounds(bounds);
      }
    }
  }

  /**
   * Setup rich Outlet Information Card Popup & Bottom Sheet
   */
  setupOutletDetailCard() {
    const card = document.getElementById('outlet-detail-card');
    const closeBtn = document.getElementById('btn-close-outlet-card');
    const navHereBtn = document.getElementById('btn-outlet-navigate');
    const simDriveBtn = document.getElementById('btn-outlet-simulate');
    const copyCoordsBtn = document.getElementById('btn-outlet-copy-coords');

    let currentOutlet = null;

    if (closeBtn && card) {
      closeBtn.addEventListener('click', () => {
        card.classList.remove('visible');
      });
    }

    if (navHereBtn) {
      navHereBtn.addEventListener('click', () => {
        if (currentOutlet) {
          card.classList.remove('visible');
          const originToUse = this.customOrigin ? { lat: this.customOrigin.lat, lng: this.customOrigin.lng } : null;
          this.navController.startNavigation(currentOutlet, originToUse, false);
        }
      });
    }

    if (simDriveBtn) {
      simDriveBtn.addEventListener('click', () => {
        if (currentOutlet) {
          card.classList.remove('visible');
          const originToUse = this.customOrigin ? { lat: this.customOrigin.lat, lng: this.customOrigin.lng } : null;
          this.navController.startNavigation(currentOutlet, originToUse, true);
        }
      });
    }

    if (copyCoordsBtn) {
      copyCoordsBtn.addEventListener('click', () => {
        if (currentOutlet) {
          const coordsStr = `${currentOutlet.lat.toFixed(6)}, ${currentOutlet.lng.toFixed(6)}`;
          navigator.clipboard.writeText(coordsStr).then(() => {
            this.showToast('Coordinates copied to clipboard!', 'success');
          }).catch(() => {
            this.showToast(`Coordinates: ${coordsStr}`, 'info');
          });
        }
      });
    }

    this._showOutletCardCallback = (outlet) => {
      currentOutlet = outlet;
      this.currentOutlet = outlet;
      this.populateOutletCard(outlet);
      if (card) card.classList.add('visible');
    };
  }

  showOutletDetails(outlet) {
    if (this._showOutletCardCallback) {
      this._showOutletCardCallback(outlet);
    }
  }

  populateOutletCard(outlet) {
    this.currentOutlet = outlet;
    const nameEl = document.getElementById('card-outlet-cust-name');
    const colorPillEl = document.getElementById('card-outlet-color-pill');
    const distEl = document.getElementById('card-outlet-dist-name');
    const typeEl = document.getElementById('card-outlet-type');
    const latEl = document.getElementById('card-outlet-lat');
    const lngEl = document.getElementById('card-outlet-lng');
    const totalOutletsEl = document.getElementById('card-outlet-total-cust-outlets');
    const destTextEl = document.getElementById('card-dest-text');
    const originTextEl = document.getElementById('card-origin-text');

    const customerOutlets = (this.dataLoader && outlet.custName) ? (this.dataLoader.getOutletsByCustomer(outlet.custName) || []) : [];
    const isDropped = Boolean(outlet.isDroppedPin);
    const isGlobal = Boolean(outlet.isGlobalPlace || isDropped || customerOutlets.length === 0);

    if (nameEl) nameEl.textContent = outlet.custName;
    if (destTextEl) destTextEl.textContent = outlet.custName || 'Selected Location';
    if (originTextEl) {
      originTextEl.textContent = this.customOrigin ? this.customOrigin.name : 'Your Location';
      originTextEl.title = this.customOrigin ? this.customOrigin.name : 'Your GPS Location';
    }
    if (colorPillEl) {
      colorPillEl.style.backgroundColor = outlet.color?.hex || '#00f0ff';
      colorPillEl.style.color = outlet.color?.textContrastColor || '#000000';
      colorPillEl.textContent = isDropped ? 'Dropped Pin' : (isGlobal ? 'Search Destination' : `${customerOutlets.length} Outlets`);
    }
    if (distEl) distEl.textContent = outlet.distName || (isDropped ? `${outlet.lat.toFixed(4)}, ${outlet.lng.toFixed(4)}` : (isGlobal ? 'Global Location' : ''));
    if (typeEl) typeEl.textContent = isDropped ? 'Map Location' : (isGlobal ? (outlet.outletType || 'Place / Landmark') : outlet.outletType);
    if (latEl) latEl.textContent = outlet.lat.toFixed(6);
    if (lngEl) lngEl.textContent = outlet.lng.toFixed(6);
    if (totalOutletsEl) {
      totalOutletsEl.textContent = isDropped
        ? 'Selected location on map • Ready for Navigation'
        : (isGlobal ? 'Worldwide Search Destination • Ready for Navigation' : `${customerOutlets.length} total outlets for this customer`);
    }

    // Compute and display travel time and distance in kilometers
    this.updateOutletCardTravelEstimate(outlet);
  }

  /**
   * Calculates live travel time and distance in kilometers for selected store or dropped pin
   * @param {object} outlet 
   */
  async updateOutletCardTravelEstimate(outlet) {
    const timeEl = document.getElementById('card-estimate-time');
    const distEl = document.getElementById('card-estimate-dist');
    const badgeEl = document.getElementById('card-estimate-badge');
    const statusEl = document.getElementById('card-estimate-status');
    const btnBadgeEl = document.getElementById('btn-navigate-badge');

    if (!timeEl || !distEl) return;

    // Reset to calculating state
    timeEl.textContent = '...';
    distEl.textContent = 'Calculating...';
    if (badgeEl) badgeEl.style.display = 'none';
    if (btnBadgeEl) btnBadgeEl.style.display = 'none';

    const requestId = `${outlet.id}-${Date.now()}`;
    this._currentEstimateRequestId = requestId;

    try {
      // 1. Determine origin (Custom Origin, User GPS, or default vicinity origin)
      let origin = null;
      if (this.customOrigin) {
        origin = { lat: this.customOrigin.lat, lng: this.customOrigin.lng };
      } else if (this.navController && this.navController.currentPosition) {
        origin = this.navController.currentPosition;
      } else if (this.navController && this.navController.getDefaultOrigin) {
        origin = this.navController.getDefaultOrigin(outlet);
      } else {
        origin = { lat: 28.4595, lng: 77.0266 };
      }

      // 2. Fast immediate Haversine approximation
      let estKm = null;
      let estMins = null;
      if (this.navController && this.navController.getHaversineDistance) {
        const straightMeters = this.navController.getHaversineDistance(origin.lat, origin.lng, outlet.lat, outlet.lng);
        const roadMeters = straightMeters * 1.3;
        estKm = (roadMeters / 1000).toFixed(1);
        estMins = Math.max(1, Math.round((roadMeters / 1000 / 35) * 60));

        if (this._currentEstimateRequestId === requestId) {
          timeEl.textContent = estMins < 60 ? `${estMins} min` : `${Math.floor(estMins / 60)} hr ${estMins % 60} min`;
          distEl.textContent = `(${estKm} km)`;
          if (btnBadgeEl) {
            btnBadgeEl.textContent = `${estMins}m • ${estKm}km`;
            btnBadgeEl.style.display = 'inline-block';
          }
        }
      }

      // 3. Query real routing service for genuine traffic-aware road distance & duration
      const result = await routingService.calculateRoute(origin, outlet);
      if (this._currentEstimateRequestId !== requestId) return; // Discard stale request

      if (result && result.primaryRoute) {
        const route = result.primaryRoute;
        timeEl.textContent = route.formattedTime;
        distEl.textContent = `(${route.formattedDistance})`;

        if (badgeEl) {
          badgeEl.style.display = 'inline-flex';
          if (route.trafficDelaySeconds > 60) {
            const delayMins = Math.round(route.trafficDelaySeconds / 60);
            if (statusEl) statusEl.textContent = `+${delayMins}m delay`;
            const dot = badgeEl.querySelector('.traffic-dot');
            if (dot) {
              dot.style.backgroundColor = '#f59e0b';
              dot.style.boxShadow = '0 0 6px #f59e0b';
            }
          } else {
            if (statusEl) statusEl.textContent = 'Fastest route';
            const dot = badgeEl.querySelector('.traffic-dot');
            if (dot) {
              dot.style.backgroundColor = '#10b981';
              dot.style.boxShadow = '0 0 6px #10b981';
            }
          }
        }

        if (btnBadgeEl) {
          btnBadgeEl.textContent = `${route.formattedTime} • ${route.formattedDistance}`;
          btnBadgeEl.style.display = 'inline-block';
        }
      }
    } catch (err) {
      console.warn('[UI] Travel estimate calculation error:', err);
      if (this._currentEstimateRequestId === requestId) {
        if (!distEl.textContent.includes('km')) {
          distEl.textContent = 'Distance available on start';
        }
      }
    }
  }

  /**
   * Setup Google Maps style Route Waypoints & Origin Selection controls
   */
  setupRouteWaypoints() {
    const changeBtn = document.getElementById('btn-change-origin');
    const swapBtn = document.getElementById('btn-swap-waypoints');
    const pickerPanel = document.getElementById('origin-picker-panel');
    const closePickerBtn = document.getElementById('btn-close-origin-picker');
    const originGpsBtn = document.getElementById('btn-origin-gps');
    const originPickMapBtn = document.getElementById('btn-origin-pick-map');
    const searchInput = document.getElementById('origin-search-input');
    const resultsContainer = document.getElementById('origin-search-results');

    // Toggle origin picker panel
    if (changeBtn && pickerPanel) {
      changeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = pickerPanel.style.display === 'none' || !pickerPanel.style.display;
        pickerPanel.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && searchInput) {
          searchInput.value = '';
          if (resultsContainer) resultsContainer.innerHTML = '';
          setTimeout(() => searchInput.focus(), 60);
        }
      });
    }

    // Close button
    if (closePickerBtn && pickerPanel) {
      closePickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pickerPanel.style.display = 'none';
      });
    }

    // Quick Option 1: "Your Location (GPS)" - resets to real GPS
    if (originGpsBtn) {
      originGpsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetCustomOrigin();
        if (pickerPanel) pickerPanel.style.display = 'none';
      });
    }

    // Quick Option 2: "Choose on map" - click anywhere on map
    if (originPickMapBtn) {
      originPickMapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startPickingOriginOnMap();
        if (pickerPanel) pickerPanel.style.display = 'none';
      });
    }

    // Swap Origin and Destination
    if (swapBtn) {
      swapBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.swapWaypoints();
      });
    }

    // Live search input with debouncing and Enter key selection
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(this._originSearchTimer);
        if (!query) {
          this._currentOriginResults = [];
          if (resultsContainer) resultsContainer.innerHTML = '';
          return;
        }
        this._originSearchTimer = setTimeout(() => {
          this.searchOriginLocations(query, resultsContainer);
        }, 180);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (this._currentOriginResults && this._currentOriginResults.length > 0) {
            const topMatch = this._currentOriginResults[0];
            this.setCustomOrigin({
              lat: topMatch.lat,
              lng: topMatch.lng,
              name: topMatch.title
            });
          }
        } else if (e.key === 'Escape') {
          if (pickerPanel) pickerPanel.style.display = 'none';
        }
      });
    }
  }

  /**
   * Search for starting locations across the whole world (places, apartments, parks, addresses, coordinates)
   * @param {string} rawQuery
   * @param {HTMLElement} container
   */
  async searchOriginLocations(rawQuery, container) {
    if (!container) return;
    const query = (rawQuery || '').trim();
    if (!query) {
      this._currentOriginResults = [];
      container.innerHTML = '';
      return;
    }

    const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

    // 1. Direct Geographic Coordinates Check: e.g. "28.4595, 77.0266" or "40.7128, -74.0060"
    const coordMatch = query.match(/^([-+]?\d{1,2}(?:\.\d+)?)\s*[, ]\s*([-+]?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      const searchLat = parseFloat(coordMatch[1]);
      const searchLng = parseFloat(coordMatch[2]);
      container.innerHTML = '';
      const coordResult = {
        type: 'coord',
        icon: '📍',
        title: `Coordinates (${searchLat.toFixed(5)}, ${searchLng.toFixed(5)})`,
        subtitle: 'Direct worldwide geographic coordinate departure point',
        badge: 'Coordinates',
        lat: searchLat,
        lng: searchLng
      };
      this._currentOriginResults = [coordResult];

      const itemEl = document.createElement('div');
      itemEl.className = 'origin-result-item';
      itemEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
          <div class="origin-result-title">📍 ${escape(coordResult.title)}</div>
          <span style="font-size: 0.6rem; padding: 1px 5px; border-radius: 4px; background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">GPS Pin</span>
        </div>
        <div class="origin-result-sub">${escape(coordResult.subtitle)}</div>
      `;
      itemEl.addEventListener('click', () => {
        this.setCustomOrigin({
          lat: searchLat,
          lng: searchLng,
          name: `Point (${searchLat.toFixed(4)}, ${searchLng.toFixed(4)})`
        });
      });
      container.appendChild(itemEl);
      return;
    }

    // Show instant loading state
    container.innerHTML = `
      <div style="font-size: 0.72rem; color: #38bdf8; padding: 6px 8px; display: flex; align-items: center; gap: 6px;">
        <span class="location-pulse-dot" style="width: 6px; height: 6px;"></span>
        <span>Searching anywhere in the world for "<strong>${escape(query)}</strong>"...</span>
      </div>
    `;

    const worldResults = [];
    const seenCoordinates = new Set();

    // Map center for geographic proximity ranking (if available)
    let centerLat = null;
    let centerLng = null;
    try {
      if (this.mapManager && this.mapManager.map) {
        const center = this.mapManager.map.getCenter();
        centerLat = center.lat;
        centerLng = center.lng;
      }
    } catch (_) {}

    // Tier 1: Direct TomTom Worldwide Search (POIs, Apartments, Parks, Landmarks, Addresses)
    const apiKey = CONFIG.getTomTomApiKey ? CONFIG.getTomTomApiKey() : (CONFIG.TOMTOM_API_KEY || 'mgndztNNLEEhOExutMyrIinaVGoxRpRw');
    if (apiKey) {
      try {
        let ttUrl = `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${apiKey}&typeahead=true&limit=8&language=en-US`;
        if (centerLat && centerLng) {
          ttUrl += `&lat=${centerLat.toFixed(5)}&lon=${centerLng.toFixed(5)}`;
        }
        const ttRes = await fetch(ttUrl, { signal: AbortSignal.timeout(3500) });
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          if (ttData.results && ttData.results.length > 0) {
            for (const item of ttData.results) {
              const pos = item.position;
              if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') continue;
              const key = `${pos.lat.toFixed(4)},${pos.lon.toFixed(4)}`;
              if (seenCoordinates.has(key)) continue;
              seenCoordinates.add(key);

              const title = item.poi?.name || item.address?.freeformAddress || query;
              const subParts = [];
              if (item.poi?.name && item.address?.freeformAddress) {
                subParts.push(item.address.freeformAddress);
              } else {
                if (item.address?.streetNumber || item.address?.streetName) {
                  subParts.push([item.address.streetNumber, item.address.streetName].filter(Boolean).join(' '));
                }
                if (item.address?.municipalitySubdivision) subParts.push(item.address.municipalitySubdivision);
                if (item.address?.municipality) subParts.push(item.address.municipality);
                if (item.address?.countrySubdivision) subParts.push(item.address.countrySubdivision);
                if (item.address?.country) subParts.push(item.address.country);
              }
              const subtitle = subParts.filter(Boolean).join(', ') || 'Worldwide Location';

              worldResults.push({
                type: 'world',
                icon: '🌍',
                title: title,
                subtitle: subtitle,
                badge: 'Worldwide',
                lat: pos.lat,
                lng: pos.lon
              });
            }
          }
        }
      } catch (ttErr) {
        console.warn('[Origin Search] TomTom search fallback:', ttErr);
      }
    }

    // Tier 2: Serverless `/api/search` proxy endpoint (if available)
    if (worldResults.length < 5) {
      try {
        let apiUrl = `/api/search?q=${encodeURIComponent(query)}`;
        if (centerLat && centerLng) {
          apiUrl += `&lat=${centerLat.toFixed(5)}&lon=${centerLng.toFixed(5)}`;
        }
        const apiRes = await fetch(apiUrl, { signal: AbortSignal.timeout(3000) });
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          const items = apiData.results || (Array.isArray(apiData) ? apiData : []);
          for (const it of items) {
            if (typeof it.lat !== 'number' || typeof it.lng !== 'number') continue;
            const key = `${it.lat.toFixed(4)},${it.lng.toFixed(4)}`;
            if (seenCoordinates.has(key)) continue;
            seenCoordinates.add(key);

            worldResults.push({
              type: 'world',
              icon: '📍',
              title: it.title || it.name || 'Location',
              subtitle: it.subtitle || it.fullAddress || `${it.lat.toFixed(4)}, ${it.lng.toFixed(4)}`,
              badge: 'Place',
              lat: it.lat,
              lng: it.lng
            });
          }
        }
      } catch (_) {}
    }

    // Tier 3: Photon Komoot OSM Worldwide Geocoder
    if (worldResults.length < 4) {
      try {
        let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8`;
        if (centerLat && centerLng) {
          photonUrl += `&lat=${centerLat.toFixed(5)}&lon=${centerLng.toFixed(5)}`;
        }
        const photonRes = await fetch(photonUrl, { signal: AbortSignal.timeout(3000) });
        if (photonRes.ok) {
          const photonData = await photonRes.json();
          if (photonData.features && photonData.features.length > 0) {
            for (const f of photonData.features) {
              const coords = f.geometry?.coordinates; // [lon, lat]
              if (!coords || coords.length < 2) continue;
              const lat = coords[1];
              const lng = coords[0];
              const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
              if (seenCoordinates.has(key)) continue;
              seenCoordinates.add(key);

              const props = f.properties || {};
              const title = props.name || props.street || props.city || query;
              const sub = [props.street, props.district, props.city, props.state, props.country].filter(Boolean).join(', ');

              worldResults.push({
                type: 'world',
                icon: '📍',
                title: title,
                subtitle: sub || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                badge: 'Worldwide',
                lat: lat,
                lng: lng
              });
            }
          }
        }
      } catch (_) {}
    }

    // Tier 4: OpenStreetMap Nominatim Worldwide Geocoder
    if (worldResults.length < 3) {
      try {
        const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`;
        const nomRes = await fetch(nomUrl, { signal: AbortSignal.timeout(3000) });
        if (nomRes.ok) {
          const nomData = await nomRes.json();
          if (Array.isArray(nomData)) {
            for (const it of nomData) {
              const lat = parseFloat(it.lat);
              const lng = parseFloat(it.lon);
              if (isNaN(lat) || isNaN(lng)) continue;
              const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
              if (seenCoordinates.has(key)) continue;
              seenCoordinates.add(key);

              worldResults.push({
                type: 'world',
                icon: '📍',
                title: it.name || it.display_name.split(',')[0],
                subtitle: it.display_name,
                badge: 'Worldwide',
                lat: lat,
                lng: lng
              });
            }
          }
        }
      } catch (_) {}
    }

    // Secondary: Database Stores matching search query
    const storeResults = [];
    if (this.dataLoader && this.dataLoader.outlets) {
      const cleanLower = query.toLowerCase();
      const matched = this.dataLoader.outlets.filter(o => {
        return (o.custName && o.custName.toLowerCase().includes(cleanLower)) ||
               (o.distName && o.distName.toLowerCase().includes(cleanLower));
      }).slice(0, 3);

      for (const o of matched) {
        storeResults.push({
          type: 'store',
          icon: '🏪',
          title: o.custName,
          subtitle: `${o.distName || 'Store'} • (${o.lat.toFixed(4)}, ${o.lng.toFixed(4)})`,
          badge: 'Store',
          lat: o.lat,
          lng: o.lng
        });
      }
    }

    // Worldwide results FIRST, store results secondary
    const combinedResults = [...worldResults, ...storeResults];

    if (combinedResults.length === 0) {
      this._currentOriginResults = [];
      container.innerHTML = `
        <div style="font-size: 0.72rem; color: var(--text-muted); padding: 8px 10px; text-align: center;">
          <span>No places, apartments, or addresses found for "<strong>${escape(query)}</strong>".</span><br>
          <span style="font-size: 0.66rem; color: #38bdf8; margin-top: 4px; display: inline-block;">Tip: Try city name, landmark, address, or click "Choose on map".</span>
        </div>
      `;
      return;
    }

    this._currentOriginResults = combinedResults;
    container.innerHTML = '';
    combinedResults.forEach((r, idx) => {
      const itemEl = document.createElement('div');
      itemEl.className = `origin-result-item ${idx === 0 ? 'top-match' : ''}`;
      itemEl.dataset.idx = idx;
      itemEl.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
          <div class="origin-result-title">${r.icon} ${escape(r.title)}</div>
          <span style="font-size: 0.6rem; padding: 1px 5px; border-radius: 4px; background: ${r.type === 'store' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)'}; color: ${r.type === 'store' ? '#10b981' : '#38bdf8'}; border: 1px solid ${r.type === 'store' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(56, 189, 248, 0.3)'}; flex-shrink: 0;">${r.badge}</span>
        </div>
        <div class="origin-result-sub">${escape(r.subtitle)}</div>
      `;
      itemEl.addEventListener('click', () => {
        this.setCustomOrigin({
          lat: r.lat,
          lng: r.lng,
          name: r.title
        });
      });
      container.appendChild(itemEl);
    });
  }

  /**
   * Sets custom departure point and recalculates route travel metrics
   * @param {object} origin { lat, lng, name }
   */
  setCustomOrigin(origin) {
    this.customOrigin = origin;
    const originText = document.getElementById('card-origin-text');
    if (originText) {
      originText.textContent = origin.name || `${origin.lat.toFixed(4)}, ${origin.lng.toFixed(4)}`;
      originText.title = origin.name || '';
    }
    const pickerPanel = document.getElementById('origin-picker-panel');
    if (pickerPanel) pickerPanel.style.display = 'none';

    // Place marker on map
    if (this.mapManager && this.mapManager.setCustomOriginMarker) {
      this.mapManager.setCustomOriginMarker(origin);
    }

    // Recalculate route estimate
    if (this.currentOutlet) {
      this.updateOutletCardTravelEstimate(this.currentOutlet);
    }

    this.showToast(`Starting point: ${origin.name || 'Custom Location'}`, 'info');
  }

  /**
   * Resets starting location to User GPS location
   */
  resetCustomOrigin() {
    this.customOrigin = null;
    const originText = document.getElementById('card-origin-text');
    if (originText) {
      originText.textContent = 'Your Location';
      originText.title = 'GPS Location';
    }
    if (this.mapManager && this.mapManager.clearCustomOriginMarker) {
      this.mapManager.clearCustomOriginMarker();
    }
    if (this.currentOutlet) {
      this.updateOutletCardTravelEstimate(this.currentOutlet);
    }
    this.showToast('Starting point reset to Your Location (GPS)', 'info');
  }

  /**
   * Enters "Choose on map" mode for picking starting location
   */
  startPickingOriginOnMap() {
    this.isPickingOriginOnMap = true;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.add('picking-origin-mode');
    document.body.classList.add('picking-origin-mode');
    this.showToast('Click anywhere on the map to set starting point 📍', 'info');
  }

  /**
   * Sets custom origin from map click coordinates with reverse geocoding
   * @param {number} lat
   * @param {number} lng
   */
  async setCustomOriginFromMap(lat, lng) {
    this.isPickingOriginOnMap = false;
    const mapEl = document.getElementById('map');
    if (mapEl) mapEl.classList.remove('picking-origin-mode');
    document.body.classList.remove('picking-origin-mode');

    const origin = {
      lat: lat,
      lng: lng,
      name: `Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`
    };
    this.setCustomOrigin(origin);

    // Reverse geocode in background to obtain street / area name
    try {
      let title = null;
      try {
        const res = await fetch(`/api/search?reverse=true&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.title && data.title !== 'Dropped Pin') {
            title = data.title;
          }
        }
      } catch (_) {}

      if (!title) {
        try {
          const photonUrl = `https://photon.komoot.io/reverse?lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`;
          const res = await fetch(photonUrl, { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const data = await res.json();
            if (data && data.features && data.features.length > 0) {
              const props = data.features[0].properties;
              title = props.name || props.street || props.district || props.city;
            }
          }
        } catch (_) {}
      }

      if (title && this.customOrigin && Math.abs(this.customOrigin.lat - lat) < 0.0001 && Math.abs(this.customOrigin.lng - lng) < 0.0001) {
        this.customOrigin.name = title;
        const originText = document.getElementById('card-origin-text');
        if (originText) {
          originText.textContent = title;
          originText.title = title;
        }
        if (this.mapManager && this.mapManager.setCustomOriginMarker) {
          this.mapManager.setCustomOriginMarker(this.customOrigin);
        }
      }
    } catch (_) {}
  }

  /**
   * Swaps current starting point and destination
   */
  swapWaypoints() {
    if (!this.currentOutlet) return;

    let oldOrigin = null;
    if (this.customOrigin) {
      oldOrigin = { ...this.customOrigin };
    } else if (this.navController && this.navController.currentPosition) {
      oldOrigin = {
        lat: this.navController.currentPosition.lat,
        lng: this.navController.currentPosition.lng,
        name: 'Your Location'
      };
    } else {
      this.showToast('Current starting location unknown; cannot swap.', 'warning');
      return;
    }

    const oldDest = { ...this.currentOutlet };

    // Set new origin as old destination
    this.customOrigin = {
      lat: oldDest.lat,
      lng: oldDest.lng,
      name: oldDest.custName || 'Selected Location'
    };

    // Set new destination as old origin
    const newDest = {
      id: `swap-dest-${Date.now()}`,
      custName: oldOrigin.name || 'Previous Origin',
      distName: `${oldOrigin.lat.toFixed(5)}, ${oldOrigin.lng.toFixed(5)}`,
      outletType: 'Custom Destination',
      lat: oldOrigin.lat,
      lng: oldOrigin.lng,
      color: { hex: '#f43f5e', textContrastColor: '#ffffff', name: 'Destination' },
      isDroppedPin: true
    };

    this.currentOutlet = newDest;
    this.populateOutletCard(newDest);

    if (this.mapManager) {
      if (this.mapManager.setCustomOriginMarker) {
        this.mapManager.setCustomOriginMarker(this.customOrigin);
      }
      this.mapManager.selectOutlet(newDest, false);
    }

    this.showToast('Starting point and destination swapped 🔄', 'info');
  }

  /**
   * Fortune 500 Executive Theme Engine
   * Supports Obsidian Stealth, Midnight Executive, Cyber Neon, Enterprise Light
   */
  setupThemeEngine() {
    const savedTheme = localStorage.getItem('fleetnav_theme') || 'stealth';
    this.applyTheme(savedTheme, false);

    const themeContainer = document.getElementById('theme-presets-container');
    if (themeContainer) {
      themeContainer.querySelectorAll('.theme-card').forEach(card => {
        card.addEventListener('click', () => {
          const themeVal = card.dataset.themeVal;
          if (themeVal) {
            this.applyTheme(themeVal, true);
          }
        });
      });
    }
  }

  /**
   * Applies selected visual theme across entire DOM and persists preference
   */
  applyTheme(themeName, showNotification = true) {
    document.documentElement.setAttribute('data-theme', themeName);
    localStorage.setItem('fleetnav_theme', themeName);

    // Update active card styling
    const themeCards = document.querySelectorAll('#theme-presets-container .theme-card');
    themeCards.forEach(card => {
      card.classList.toggle('active', card.dataset.themeVal === themeName);
    });

    if (showNotification) {
      const names = {
        stealth: 'Obsidian Stealth',
        midnight: 'Midnight Executive',
        cyber: 'Cyber Neon',
        light: 'Enterprise Daylight'
      };
      this.showToast(`Theme: ${names[themeName] || themeName}`, 'info');
    }
  }

  /**
   * Global Keyboard Shortcuts (⌘K search focus, Esc modals close)
   */
  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // ⌘K or Ctrl+K -> Focus Search
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          // If on mobile and drawer is closed, open it
          const sidebar = document.getElementById('app-sidebar');
          if (window.innerWidth <= 768 && sidebar && !sidebar.classList.contains('mobile-open')) {
            sidebar.classList.add('mobile-open');
            const backdrop = document.getElementById('sidebar-backdrop');
            if (backdrop) backdrop.classList.add('visible');
          }
          searchInput.focus();
          searchInput.select();
        }
      }

      // Escape -> Dismiss active modals or cards
      if (e.key === 'Escape') {
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('visible')) {
          settingsModal.classList.remove('visible');
          return;
        }

        const helpModal = document.getElementById('location-help-modal');
        if (helpModal && helpModal.classList.contains('visible')) {
          helpModal.classList.remove('visible');
          return;
        }

        const promptModal = document.getElementById('location-prompt-modal');
        if (promptModal && promptModal.classList.contains('visible')) {
          promptModal.classList.remove('visible');
          return;
        }

        const outletCard = document.getElementById('outlet-detail-card');
        if (outletCard && outletCard.classList.contains('visible')) {
          outletCard.classList.remove('visible');
          return;
        }
      }
    });
  }

  openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // Sync current values with UI controls
    const themeVal = localStorage.getItem('fleetnav_theme') || 'stealth';
    document.querySelectorAll('#theme-presets-container .theme-card').forEach(card => {
      card.classList.toggle('active', card.dataset.themeVal === themeVal);
    });

    const mapThemeSelect = document.getElementById('settings-map-theme');
    if (mapThemeSelect) {
      const savedMapTheme = localStorage.getItem('fleetnav_map_theme');
      if (savedMapTheme) mapThemeSelect.value = savedMapTheme;
    }

    const voiceChk = document.getElementById('chk-voice-guidance');
    if (voiceChk) {
      voiceChk.checked = this.navController.voiceEnabled;
    }

    const recalcChk = document.getElementById('chk-auto-recalculate');
    if (recalcChk) {
      recalcChk.checked = this.navController.autoRecalculateEnabled;
    }

    const currentSpeed = this.navController.simSpeedMultiplier || 1;
    document.querySelectorAll('#sim-speed-segmented .segment-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.speed, 10) === currentSpeed);
    });

    modal.classList.add('visible');
  }

  /**
   * Setup Executive Settings & Telemetry Modal (Clean, No API keys)
   */
  setupExecutiveSettings() {
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('btn-open-settings');
    const closeBtn = document.getElementById('btn-close-settings');
    const saveBtn = document.getElementById('btn-save-settings');
    const mapThemeSelect = document.getElementById('settings-map-theme');
    const voiceChk = document.getElementById('chk-voice-guidance');
    const testVoiceBtn = document.getElementById('btn-test-voice');
    const recalcChk = document.getElementById('chk-auto-recalculate');
    const simSpeedSegmented = document.getElementById('sim-speed-segmented');

    // Load persisted settings
    const savedMapTheme = localStorage.getItem('fleetnav_map_theme');
    if (savedMapTheme && mapThemeSelect) {
      mapThemeSelect.value = savedMapTheme;
    }

    const savedVoicePref = localStorage.getItem('fleetnav_voice_enabled');
    if (savedVoicePref !== null && voiceChk) {
      const isVoiceOn = savedVoicePref === 'true';
      voiceChk.checked = isVoiceOn;
      this.navController.voiceEnabled = isVoiceOn;
    }

    const savedRecalcPref = localStorage.getItem('fleetnav_auto_recalculate');
    if (savedRecalcPref !== null && recalcChk) {
      const isRecalcOn = savedRecalcPref === 'true';
      recalcChk.checked = isRecalcOn;
      this.navController.autoRecalculateEnabled = isRecalcOn;
    }

    const savedSimSpeed = localStorage.getItem('fleetnav_sim_speed');
    if (savedSimSpeed) {
      const spd = parseInt(savedSimSpeed, 10);
      this.navController.simSpeedMultiplier = spd;
      if (simSpeedSegmented) {
        simSpeedSegmented.querySelectorAll('.segment-btn').forEach(btn => {
          btn.classList.toggle('active', parseInt(btn.dataset.speed, 10) === spd);
        });
      }
    }

    if (openBtn) {
      openBtn.addEventListener('click', () => this.openSettingsModal());
    }

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', () => modal.classList.remove('visible'));
    }

    // Close when clicking modal backdrop outside box
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.classList.remove('visible');
        }
      });
    }

    // Quick Floating Map Layer Switcher (Streets/Buildings vs Satellite vs Dark)
    const quickLayerContainer = document.getElementById('map-quick-layers');
    if (quickLayerContainer) {
      const activeLayer = savedMapTheme || 'google_streets';
      quickLayerContainer.querySelectorAll('.layer-pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.layer === activeLayer);
        btn.addEventListener('click', () => {
          const layerKey = btn.dataset.layer;
          this.mapManager.setTileProvider(layerKey);
          localStorage.setItem('fleetnav_map_theme', layerKey);
          if (mapThemeSelect) mapThemeSelect.value = layerKey;

          quickLayerContainer.querySelectorAll('.layer-pill-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          const label = btn.textContent.trim();
          this.showToast(`Map layer: ${label}`, 'info');
        });
      });
    }

    // Basemap cartography style live switcher
    if (mapThemeSelect) {
      mapThemeSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        this.mapManager.setTileProvider(val);
        localStorage.setItem('fleetnav_map_theme', val);
        if (quickLayerContainer) {
          quickLayerContainer.querySelectorAll('.layer-pill-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.layer === val);
          });
        }
        this.showToast(`Map cartography: ${mapThemeSelect.options[mapThemeSelect.selectedIndex].text}`, 'info');
      });
    }

    // Voice guidance toggle
    if (voiceChk) {
      voiceChk.addEventListener('change', (e) => {
        this.navController.voiceEnabled = e.target.checked;
        localStorage.setItem('fleetnav_voice_enabled', e.target.checked);
        const hudVoiceBtn = document.getElementById('btn-nav-voice');
        if (hudVoiceBtn) hudVoiceBtn.classList.toggle('active', e.target.checked);
      });
    }

    // Speech synthesis test button
    if (testVoiceBtn) {
      testVoiceBtn.addEventListener('click', () => {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance('FleetNav telemetry active. In 200 meters, turn right on Grand Trunk Road.');
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          window.speechSynthesis.speak(utterance);
          this.showToast('Synthesizing navigation test audio...', 'info');
        } else {
          this.showToast('Web Speech API is not supported in this browser.', 'warning');
        }
      });
    }

    // Autonomous route deviation recalculation toggle
    if (recalcChk) {
      recalcChk.addEventListener('change', (e) => {
        this.navController.autoRecalculateEnabled = e.target.checked;
        localStorage.setItem('fleetnav_auto_recalculate', e.target.checked);
      });
    }

    // Segmented Simulation Speed Buttons
    if (simSpeedSegmented) {
      simSpeedSegmented.querySelectorAll('.segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          simSpeedSegmented.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const speedVal = parseInt(btn.dataset.speed, 10);
          this.navController.simSpeedMultiplier = speedVal;
          localStorage.setItem('fleetnav_sim_speed', speedVal);

          const hudSimSpeedBtn = document.getElementById('btn-sim-speed');
          if (hudSimSpeedBtn) hudSimSpeedBtn.textContent = `${speedVal}x`;
          this.showToast(`Simulation speed set to ${speedVal}x`, 'info');
        });
      });
    }

    // Save & apply button
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        if (mapThemeSelect) {
          this.mapManager.setTileProvider(mapThemeSelect.value);
          localStorage.setItem('fleetnav_map_theme', mapThemeSelect.value);
        }
        if (modal) modal.classList.remove('visible');
        this.showToast('Preferences applied successfully', 'success');
      });
    }
  }

  /**
   * Display toast notification
   * @param {string} message 
   * @param {string} type 'info' | 'success' | 'warning' | 'error'
   */
  showToast(message, type = 'info') {
    if (!this.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✓';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '✕';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-text">${this.escapeHtml(message)}</span>
    `;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('visible');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
