/**
 * Application Configuration
 * Centralized settings for API keys, map styles, and navigation parameters.
 */

export const CONFIG = {
  // TomTom API Key: Free 2,500 daily requests tier without credit card requirement.
  // Can be configured here, or updated dynamically in the in-app Settings modal (stored in localStorage).
  DEFAULT_TOMTOM_API_KEY: 'mgndztNNLEEhOExutMyrIinaVGoxRpRw',

  // Basemap API Key
  DEFAULT_BASEMAP_API_KEY: 'cb1_2rxo_1_7b56056fe6ebe0c0d3a7104a',

  // Tile Providers (Supporting Google Maps high-density buildings, TomTom official tiles, and OSM/CARTO)
  TILE_PROVIDERS: {
    google_streets: {
      name: 'Google Maps Streets (High-Density & Buildings)',
      getUrl: () => 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3']
    },
    google_hybrid: {
      name: 'Google Maps Satellite (Real Buildings & Rooftops)',
      getUrl: () => 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps Satellite & Aerial',
      maxZoom: 21,
      subdomains: ['0', '1', '2', '3']
    },
    google_terrain: {
      name: 'Google Maps Terrain (Urban & Topography)',
      getUrl: () => 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      maxZoom: 20,
      subdomains: ['0', '1', '2', '3']
    },
    osm_dense: {
      name: 'OpenStreetMap Detailed (Complete Building Outlines)',
      getUrl: () => 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      subdomains: 'abc'
    },
    tomtom_dark: {
      name: 'TomTom Dark Logistics (Official)',
      getUrl: (tomtomKey) => `https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?key=${tomtomKey}`,
      attribution: '&copy; <a href="https://www.tomtom.com">TomTom</a>',
      maxZoom: 20
    },
    tomtom_main: {
      name: 'TomTom Daylight (Official)',
      getUrl: (tomtomKey) => `https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${tomtomKey}`,
      attribution: '&copy; <a href="https://www.tomtom.com">TomTom</a>',
      maxZoom: 20
    },
    dark: {
      name: 'CARTO Dark Matter (Minimalist)',
      getUrl: () => 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd'
    },
    voyager: {
      name: 'CARTO Voyager Fleet',
      getUrl: () => 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd'
    },
    positron: {
      name: 'CARTO Clean Light',
      getUrl: () => 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd'
    }
  },

  DEFAULT_TILE_PROVIDER: 'google_streets',

  // Marker Clustering Configuration
  CLUSTERING: {
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    disableClusteringAtZoom: 17,
    chunkedLoading: true,
    chunkInterval: 100,
    chunkDelay: 10
  },

  // Navigation & GPS Parameters
  NAVIGATION: {
    // Distance in meters from route polyline before triggering recalculation
    DEVIATION_THRESHOLD_METERS: 28,
    // Distance threshold for immediate/instant recalculation (e.g. clearly turned into wrong road)
    FAST_DEVIATION_THRESHOLD_METERS: 45,
    // Minimum consecutive off-route position updates for subtle deviation (28-45m)
    DEVIATION_CONFIRMATION_COUNT: 2,
    // Minimum time (ms) between automatic route recalculations
    MIN_RECALCULATE_INTERVAL_MS: 3000,
    // Distance in meters to consider destination reached
    ARRIVAL_THRESHOLD_METERS: 30,
    // Default simulated drive speed (km/h)
    DEFAULT_SIM_SPEED_KMH: 50,
    // Camera follow zoom level
    FOLLOW_ZOOM_LEVEL: 17
  },

  // Path to data file
  DATA_PATH: './data/outlets.csv',

  // Helper to get active TomTom API key
  getTomTomApiKey() {
    if (typeof localStorage !== 'undefined') {
      const customKey = localStorage.getItem('tomtom_api_key');
      if (customKey && customKey.trim().length > 0) {
        return customKey.trim();
      }
    }
    return this.DEFAULT_TOMTOM_API_KEY;
  },

  // Helper to set TomTom API key in localStorage
  setTomTomApiKey(key) {
    if (typeof localStorage !== 'undefined') {
      if (key && key.trim().length > 0) {
        localStorage.setItem('tomtom_api_key', key.trim());
      } else {
        localStorage.removeItem('tomtom_api_key');
      }
    }
  },

  // Helper to get active Basemap API key
  getBasemapApiKey() {
    if (typeof localStorage !== 'undefined') {
      const customKey = localStorage.getItem('basemap_api_key');
      if (customKey && customKey.trim().length > 0) {
        return customKey.trim();
      }
    }
    return this.DEFAULT_BASEMAP_API_KEY;
  },

  // Helper to set Basemap API key in localStorage
  setBasemapApiKey(key) {
    if (typeof localStorage !== 'undefined') {
      if (key && key.trim().length > 0) {
        localStorage.setItem('basemap_api_key', key.trim());
      } else {
        localStorage.removeItem('basemap_api_key');
      }
    }
  }
};


