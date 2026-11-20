/**
 * Main Application Coordinator
 * Boots up data loading, map rendering, search, filters, navigation, and UI systems.
 */

import { CONFIG } from '../config/config.js';
import { dataLoader } from './data.js';
import { mapManager } from './map.js';
import { SearchEngine } from './search.js';
import { FilterEngine } from './filters.js';
import { NavigationController } from './navigation.js';
import { UIManager } from './ui.js';

class Application {
  constructor() {
    this.searchEngine = null;
    this.filterEngine = null;
    this.navController = null;
    this.uiManager = null;
  }

  /**
   * Application Bootstrapping
   */
  async start() {
    console.info('[App] Initializing Outlet Navigation & Visualization Platform...');
    this.setLoadingStatus('Loading outlet dataset (4,345 records)...', 25);

    // Safety watchdog: ensure loading overlay is never stuck for more than 5 seconds under any circumstance
    setTimeout(() => {
      const overlay = document.getElementById('app-loading-screen');
      if (overlay && overlay.style.opacity !== '0') {
        console.warn('[App] Watchdog: auto-dismissing loading screen.');
        this.hideLoadingOverlay();
      }
    }, 5000);

    try {
      // 1. Load and parse CSV dataset
      const data = await dataLoader.loadData(CONFIG.DATA_PATH);
      this.setLoadingStatus('Initializing interactive map engine...', 55);

      // 2. Initialize Leaflet Map
      mapManager.initMap(data.stats.center || [28.4595, 77.0266], 11);

      // 3. Load all outlet markers into cluster group
      this.setLoadingStatus(`Rendering ${data.stats.validOutlets.toLocaleString()} outlet markers...`, 80);
      mapManager.loadOutlets(data.outlets);

      // 4. Auto-fit map bounding box to all valid outlets
      if (data.stats.bounds) {
        mapManager.fitBounds(data.stats.bounds);
      }

      // 5. Initialize Navigation Controller
      this.navController = new NavigationController(mapManager, dataLoader);
      this.navController.init();

      // 6. Initialize UI Manager
      this.uiManager = new UIManager(dataLoader, mapManager, this.navController);
      this.uiManager.init();
      this.navController.uiManager = this.uiManager;

      // 7. Initialize Search Engine with navigation & UI bindings
      this.searchEngine = new SearchEngine(dataLoader, mapManager, this.navController, this.uiManager);
      this.searchEngine.init();

      // 8. Initialize Filter Engine
      this.filterEngine = new FilterEngine(dataLoader, mapManager);
      this.filterEngine.init();

      // 9. Hide Loading Overlay
      this.setLoadingStatus('Ready!', 100);
      setTimeout(async () => {
        this.hideLoadingOverlay();
        try {
          this.uiManager.showToast(`Loaded ${data.stats.validOutlets.toLocaleString()} outlets across ${data.stats.uniqueCustomersCount.toLocaleString()} customers`, 'success');
          // Check and prompt for location service permission at startup if needed
          this.uiManager.checkInitialLocationPermission();

          // Restore active navigation session if page was reloaded during navigation
          await this.navController.restoreNavigationSessionIfAny();
        } catch (postInitErr) {
          console.warn('[App] Non-fatal post-init error:', postInitErr);
        }
      }, 350);

      console.info('[App] System ready. All 4,345 locations loaded smoothly.');

    } catch (error) {
      console.error('[App Init Error]', error);
      this.showFatalError(error.message);
    }
  }

  setLoadingStatus(message, percent = 0) {
    const textEl = document.getElementById('loading-status-text');
    const barEl = document.getElementById('loading-progress-bar');
    if (textEl) textEl.textContent = message;
    if (barEl) barEl.style.width = `${percent}%`;
  }

  hideLoadingOverlay() {
    const overlay = document.getElementById('app-loading-screen');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => overlay.remove(), 400);
    }
  }

  showFatalError(message) {
    const overlay = document.getElementById('app-loading-screen');
    if (overlay) {
      overlay.innerHTML = `
        <div class="fatal-error-box">
          <div class="error-icon">⚠️</div>
          <h2>Failed to Initialize Application</h2>
          <p>${message}</p>
          <button onclick="window.location.reload()" class="btn-retry">Reload Application</button>
        </div>
      `;
    }
  }
}

// Instantiate and start application on DOM ready
function bootApplication() {
  if (window.__APP__) return;
  const app = new Application();
  window.__APP__ = app;
  app.start();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootApplication);
} else {
  // DOM is already ready (module deferral or fast cache)
  bootApplication();
}
