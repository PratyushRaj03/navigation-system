/**
 * Universal Global Search Engine
 * 100% Dedicated to Worldwide Place, Apartment, Park, Landmark & Address Search.
 * Powered by TomTom Global Search, Photon Geocoder & OpenStreetMap Nominatim.
 */

import { CONFIG } from '../config/config.js';

export class SearchEngine {
  constructor(dataLoader, mapManager, navController = null, uiManager = null) {
    this.dataLoader = dataLoader;
    this.mapManager = mapManager;
    this.navController = navController;
    this.uiManager = uiManager;
    this.searchInput = null;
    this.resultsContainer = null;
    this.clearBtn = null;
    this.submitBtn = null;
    this.selectedIndex = -1;
    this.currentResults = [];
    this.debounceTimer = null;
    this.currentAbortController = null;
    this.lastQuery = '';
    this.isSearching = false;
  }

  /**
   * Initialize search listeners and DOM bindings
   */
  init(searchInputId = 'search-input', resultsContainerId = 'search-results', clearBtnId = 'search-clear-btn') {
    this.searchInput = document.getElementById(searchInputId);
    this.resultsContainer = document.getElementById(resultsContainerId);
    this.clearBtn = document.getElementById(clearBtnId);
    this.submitBtn = document.getElementById('search-submit-btn');

    if (!this.searchInput || !this.resultsContainer) {
      console.warn('[SearchEngine] Search DOM elements not found.');
      return;
    }

    // Input typing listener
    this.searchInput.addEventListener('input', (e) => {
      clearTimeout(this.debounceTimer);
      const query = e.target.value;
      if (this.clearBtn) {
        this.clearBtn.style.display = query.length > 0 ? 'block' : 'none';
      }
      this.debounceTimer = setTimeout(() => this.performSearch(query, false), 200);
    });

    // Enter & Arrow keys navigation
    this.searchInput.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Clear search button (×)
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => {
        this.searchInput.value = '';
        this.clearBtn.style.display = 'none';
        this.hideResults();
        this.searchInput.focus();
      });
    }

    // Clickable Search Button
    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const query = this.searchInput.value.trim();
        if (query.length > 0) {
          this.performSearch(query, true /* auto-select top match on explicit search */);
        } else {
          this.searchInput.focus();
        }
      });
    }

    // Hide search results when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.searchInput.contains(e.target) && 
          !this.resultsContainer.contains(e.target) && 
          (!this.submitBtn || !this.submitBtn.contains(e.target))) {
        this.hideResults();
      }
    });

    this.searchInput.addEventListener('focus', () => {
      if (this.searchInput.value.trim().length > 0 && this.currentResults.length > 0) {
        this.resultsContainer.classList.add('visible');
      }
    });

    // Global keyboard shortcut (Ctrl+K or Command+K)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
      }
    });
  }

  /**
   * Executes universal search for any place, apartment, park, address, or coordinates worldwide
   * @param {string} rawQuery 
   * @param {boolean} autoSelectTopMatch 
   */
  async performSearch(rawQuery, autoSelectTopMatch = false) {
    const query = (rawQuery || '').trim();
    this.selectedIndex = -1;
    this.lastQuery = query;

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    if (!query || query.length < 1) {
      this.hideResults();
      return;
    }

    // 1. Check if query is coordinate format: "28.45, 77.05"
    const coordMatch = query.match(/^([-+]?\d{1,2}(?:\.\d+)?)\s*[, ]\s*([-+]?\d{1,3}(?:\.\d+)?)$/);
    if (coordMatch) {
      const searchLat = parseFloat(coordMatch[1]);
      const searchLng = parseFloat(coordMatch[2]);
      this.searchByCoordinates(searchLat, searchLng, autoSelectTopMatch);
      return;
    }

    // If query is very short (1 char), wait for more input
    if (query.length < 2) {
      this.hideResults();
      return;
    }

    // Show instant loading state in dropdown
    this.isSearching = true;
    this.renderLoading(query);

    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    try {
      const results = await this.searchGlobalPlaces(query, signal);

      if (this.lastQuery === query) {
        this.isSearching = false;
        this.currentResults = results;
        this.renderResults(this.currentResults, query);

        if (autoSelectTopMatch && this.currentResults.length > 0) {
          this.selectResult(this.currentResults[0]);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[SearchEngine] Search failed:', err);
      }
      if (this.lastQuery === query) {
        this.isSearching = false;
        this.renderResults(this.currentResults, query);
      }
    }
  }

  /**
   * Queries Worldwide Places, Apartments, Parks & Landmarks
   * Uses both the Vercel Serverless Search Proxy and direct client-side fallback.
   * @param {string} query 
   * @param {AbortSignal} signal 
   * @returns {Promise<Array>}
   */
  async searchGlobalPlaces(query, signal) {
    if (!query || query.trim().length < 2) return [];

    const cleanQuery = query.trim();
    const results = [];

    // Map center for proximity ranking
    let centerLat = null;
    let centerLng = null;
    try {
      if (this.mapManager && this.mapManager.map) {
        const center = this.mapManager.map.getCenter();
        centerLat = center.lat;
        centerLng = center.lng;
      }
    } catch (_) {}

    // 1. Query Serverless Endpoint `/api/search` (Combines TomTom + Photon + Nominatim)
    try {
      let apiUrl = `/api/search?q=${encodeURIComponent(cleanQuery)}`;
      if (centerLat && centerLng) {
        apiUrl += `&lat=${centerLat.toFixed(5)}&lon=${centerLng.toFixed(5)}`;
      }

      const res = await fetch(apiUrl, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.results && Array.isArray(data.results) && data.results.length > 0) {
          for (const item of data.results) {
            if (typeof item.lat !== 'number' || typeof item.lng !== 'number') continue;

            const outletObj = {
              id: item.id || `place-${Math.random().toString(36).substr(2, 9)}`,
              custName: item.title,
              distName: item.subtitle,
              outletType: item.type || 'Place / Landmark',
              lat: item.lat,
              lng: item.lng,
              color: { hex: '#00f0ff', textContrastColor: '#000000', name: 'Cyan Neon' },
              isGlobalPlace: true
            };

            results.push({
              type: 'global_place',
              title: item.title,
              subtitle: item.subtitle,
              badgeText: '📍 Place / Address',
              color: outletObj.color,
              score: 100,
              outlet: outletObj
            });
          }
        }
      }
    } catch (apiErr) {
      if (apiErr.name === 'AbortError') throw apiErr;
    }

    // 2. Direct TomTom Client-side Fallback if `/api/search` returned 0 results
    if (results.length === 0) {
      const apiKey = CONFIG.getTomTomApiKey();
      if (apiKey) {
        try {
          let ttUrl = `https://api.tomtom.com/search/2/search/${encodeURIComponent(cleanQuery)}.json?key=${apiKey}&typeahead=true&limit=10&language=en-US`;
          if (centerLat && centerLng) {
            ttUrl += `&lat=${centerLat.toFixed(5)}&lon=${centerLng.toFixed(5)}`;
          }

          const res = await fetch(ttUrl, { signal });
          if (res.ok) {
            const data = await res.json();
            if (data.results && data.results.length > 0) {
              for (const item of data.results) {
                const pos = item.position;
                if (!pos || typeof pos.lat !== 'number' || typeof pos.lon !== 'number') continue;

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

                const subtitle = subtitleParts.filter(Boolean).join(', ') || 'Worldwide Location';
                const outletType = item.poi?.classifications?.[0]?.code || 'Place / Landmark';

                const outletObj = {
                  id: `tt-${item.id || Math.random().toString(36).substr(2, 9)}`,
                  custName: title,
                  distName: subtitle,
                  outletType: outletType,
                  lat: pos.lat,
                  lng: pos.lon,
                  color: { hex: '#00f0ff', textContrastColor: '#000000', name: 'Cyan Neon' },
                  isGlobalPlace: true
                };

                results.push({
                  type: 'global_place',
                  title: title,
                  subtitle: subtitle,
                  badgeText: '📍 Place / Address',
                  color: outletObj.color,
                  score: 95,
                  outlet: outletObj
                });
              }
            }
          }
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          console.warn('[SearchEngine] Direct TomTom search error:', err);
        }
      }
    }

    return results;
  }

  /**
   * Search by exact coordinates
   */
  searchByCoordinates(lat, lng, autoSelect = false) {
    const coordTarget = {
      id: `coord-${lat}-${lng}`,
      custName: `Location (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
      distName: 'Custom GPS Coordinates',
      outletType: 'Coordinate Pin',
      lat: lat,
      lng: lng,
      color: { hex: '#00f0ff', textContrastColor: '#000000', name: 'Cyan Neon' },
      isGlobalPlace: true
    };

    const results = [{
      type: 'global_place',
      title: `Navigate to ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      subtitle: 'Direct Geographic Coordinates Target',
      badgeText: '📍 Coordinates',
      color: coordTarget.color,
      score: 120,
      outlet: coordTarget
    }];

    this.currentResults = results;
    this.renderResults(this.currentResults, `${lat}, ${lng}`);

    if (autoSelect) {
      this.selectResult(results[0]);
    }
  }

  /**
   * Renders the loading indicator while querying worldwide geocoders
   */
  renderLoading(query) {
    if (!this.resultsContainer) return;
    this.resultsContainer.innerHTML = `
      <div class="search-empty">
        <div class="search-mini-spinner"></div>
        <span>Searching anywhere in the world for "<strong>${this.escapeHtml(query)}</strong>"...</span>
      </div>
    `;
    this.resultsContainer.classList.add('visible');
  }

  /**
   * Renders the dropdown list of search suggestions
   */
  renderResults(results, query) {
    if (!this.resultsContainer) return;

    if (results.length === 0) {
      this.resultsContainer.innerHTML = `
        <div class="search-empty">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <span>No places, apartments, or addresses found matching "<strong>${this.escapeHtml(query)}</strong>"</span>
        </div>
      `;
      this.resultsContainer.classList.add('visible');
      return;
    }

    const html = results.map((res, index) => {
      const colorHex = res.color ? res.color.hex : '#00f0ff';
      return `
        <div class="search-result-item ${index === this.selectedIndex ? 'active' : ''}" data-index="${index}">
          <div class="result-color-indicator" style="background-color: ${colorHex}"></div>
          <div class="result-info">
            <div class="result-title">${this.highlightMatch(res.title, query)}</div>
            <div class="result-subtitle">${this.escapeHtml(res.subtitle)}</div>
          </div>
          <span class="result-badge global-badge">${this.escapeHtml(res.badgeText)}</span>
          <button class="btn-quick-nav" title="Navigate immediately" data-index="${index}" aria-label="Start Navigation">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="3 11 22 2 13 21 11 13 3 11"/>
            </svg>
            <span>Go</span>
          </button>
        </div>
      `;
    }).join('');

    this.resultsContainer.innerHTML = html;
    this.resultsContainer.classList.add('visible');

    // Attach click events to result items
    const items = this.resultsContainer.querySelectorAll('.search-result-item');
    items.forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        this.selectResult(this.currentResults[idx]);
      });
    });

    // Attach click events to quick-navigation "Go" buttons
    const navButtons = this.resultsContainer.querySelectorAll('.btn-quick-nav');
    navButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        this.quickNavigate(this.currentResults[idx]);
      });
    });
  }

  /**
   * Direct Quick-Navigation when user clicks "Go"
   * @param {object} res 
   */
  quickNavigate(res) {
    if (!res || !res.outlet) return;
    this.hideResults();

    if (this.navController) {
      this.mapManager.selectOutlet(res.outlet, true);
      this.navController.startNavigation(res.outlet, null, false);
    } else {
      this.selectResult(res);
    }
  }

  /**
   * Handles user selecting a result item
   */
  selectResult(res) {
    if (!res || !res.outlet) return;
    this.hideResults();
    this.mapManager.selectOutlet(res.outlet, true);
  }

  /**
   * Keyboard navigation (Up/Down/Enter/Escape)
   */
  handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedIndex >= 0 && this.selectedIndex < this.currentResults.length) {
        this.selectResult(this.currentResults[this.selectedIndex]);
      } else if (this.currentResults.length > 0) {
        this.selectResult(this.currentResults[0]);
      } else {
        this.performSearch(this.searchInput.value, true);
      }
      return;
    }

    if (!this.resultsContainer.classList.contains('visible') || this.currentResults.length === 0) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.currentResults.length;
      this.updateActiveItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.currentResults.length) % this.currentResults.length;
      this.updateActiveItem();
    } else if (e.key === 'Escape') {
      this.hideResults();
    }
  }

  updateActiveItem() {
    const items = this.resultsContainer.querySelectorAll('.search-result-item');
    items.forEach((item, idx) => {
      item.classList.toggle('active', idx === this.selectedIndex);
      if (idx === this.selectedIndex) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  hideResults() {
    if (this.resultsContainer) {
      this.resultsContainer.classList.remove('visible');
    }
    this.selectedIndex = -1;
  }

  highlightMatch(text, query) {
    if (!query) return this.escapeHtml(text);
    const regex = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
    return this.escapeHtml(text).replace(regex, '<mark>$1</mark>');
  }

  escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
