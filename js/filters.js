/**
 * Multi-Attribute Filtering Engine
 * Filters outlet dataset by Customer Names, Districts, and Outlet Types dynamically.
 * Combines customer records of the same name across DBs while providing separate district filter options.
 */

export class FilterEngine {
  constructor(dataLoader, mapManager) {
    this.dataLoader = dataLoader;
    this.mapManager = mapManager;
    this.selectedCustomers = new Set();
    this.selectedDistricts = new Set();
    this.selectedTypes = new Set();
    this.events = new EventTarget();
    this.container = null;
    this.allCustomersSummary = [];
  }

  /**
   * Initializes the filter panel DOM and listeners
   */
  init(containerId = 'filter-panel') {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.allCustomersSummary = this.dataLoader.getCustomersSummary('name');
    this.renderFilterOptions();
    this.bindEvents();
  }

  /**
   * Renders dynamic filter controls based on actual loaded data
   */
  renderFilterOptions() {
    const districts = Array.from(this.dataLoader.districtMap.keys()).sort();
    const types = Array.from(this.dataLoader.typeMap.keys()).sort();

    // 1. District Filters (Pills) - ALL DBs CHECKED BY DEFAULT
    const districtContainer = document.getElementById('filter-districts-list');
    if (districtContainer) {
      districtContainer.innerHTML = districts.map(dist => {
        const count = this.dataLoader.districtMap.get(dist)?.length || 0;
        return `
          <label class="filter-pill-label" data-district="${this.escapeHtml(dist)}">
            <input type="checkbox" name="filter-district" value="${this.escapeHtml(dist)}" class="filter-checkbox" checked>
            <span class="pill-text">${this.escapeHtml(dist)}</span>
            <span class="pill-badge">${count.toLocaleString()}</span>
          </label>
        `;
      }).join('');
    }

    // 2. Outlet Type Filters (Pills)
    const typeContainer = document.getElementById('filter-types-list');
    if (typeContainer) {
      typeContainer.innerHTML = types.map(t => {
        const count = this.dataLoader.typeMap.get(t)?.length || 0;
        return `
          <label class="filter-pill-label" data-type="${this.escapeHtml(t)}">
            <input type="checkbox" name="filter-type" value="${this.escapeHtml(t)}" class="filter-checkbox">
            <span class="pill-text">${this.escapeHtml(t)}</span>
            <span class="pill-badge">${count.toLocaleString()}</span>
          </label>
        `;
      }).join('');
    }

    // 3. Populate Combined Customer Filter Dropdown
    this.populateCustomerDropdown('');
  }

  /**
   * Populates the customer select dropdown with combined customer names across DBs
   * @param {string} filterText 
   */
  populateCustomerDropdown(filterText = '') {
    const customerSelect = document.getElementById('filter-customer-select');
    if (!customerSelect) return;

    const query = (filterText || '').trim().toLowerCase();
    const filtered = query 
      ? this.allCustomersSummary.filter(c => c.displayName.toLowerCase().includes(query) || c.districtsFormatted.toLowerCase().includes(query))
      : this.allCustomersSummary;

    const currentVal = customerSelect.value;

    customerSelect.innerHTML = `<option value="">-- All Combined Customers (${filtered.length}) --</option>` +
      filtered.map(c => `
        <option value="${this.escapeHtml(c.name)}" ${c.name === currentVal ? 'selected' : ''}>
          ${this.escapeHtml(c.displayName)} — ${c.count} ${c.count === 1 ? 'outlet' : 'outlets'} (${this.escapeHtml(c.districtsFormatted)})
        </option>
      `).join('');
  }

  /**
   * Binds UI events for filter buttons, inputs, and checkboxes
   */
  bindEvents() {
    const applyBtn = document.getElementById('btn-apply-filters');
    const clearBtn = document.getElementById('btn-clear-filters');
    const custSelect = document.getElementById('filter-customer-select');
    const custSearchInput = document.getElementById('filter-customer-search-input');
    const toggleDistrictsBtn = document.getElementById('btn-toggle-all-districts');

    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyFilters());
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearFilters());
    }

    // Customer search input filtering the dropdown list in real-time
    if (custSearchInput) {
      custSearchInput.addEventListener('input', (e) => {
        this.populateCustomerDropdown(e.target.value);
      });
    }

    // Toggle All DBs button
    if (toggleDistrictsBtn) {
      toggleDistrictsBtn.addEventListener('click', () => {
        const districtInputs = document.querySelectorAll('input[name="filter-district"]');
        const allChecked = Array.from(districtInputs).every(input => input.checked);
        districtInputs.forEach(input => {
          input.checked = !allChecked;
        });
        this.applyFilters();
      });
    }

    // Live auto-apply on filter changes for instantaneous response
    const districtInputs = document.querySelectorAll('input[name="filter-district"]');
    districtInputs.forEach(input => {
      input.addEventListener('change', () => this.applyFilters());
    });

    const typeInputs = document.querySelectorAll('input[name="filter-type"]');
    typeInputs.forEach(input => {
      input.addEventListener('change', () => this.applyFilters());
    });

    if (custSelect) {
      custSelect.addEventListener('change', () => this.applyFilters());
    }
  }

  /**
   * Evaluates current filter selections and updates map markers
   */
  applyFilters() {
    const totalDistrictsCount = this.dataLoader.districtMap.size;

    // 1. Gather Selected Districts
    this.selectedDistricts.clear();
    const districtInputs = document.querySelectorAll('input[name="filter-district"]:checked');
    districtInputs.forEach(input => this.selectedDistricts.add(input.value));

    // If no district is checked, default to all districts so map does not unexpectedly go blank
    const filterByDistrict = this.selectedDistricts.size > 0 && this.selectedDistricts.size < totalDistrictsCount;

    // 2. Gather Selected Types
    this.selectedTypes.clear();
    const typeInputs = document.querySelectorAll('input[name="filter-type"]:checked');
    typeInputs.forEach(input => this.selectedTypes.add(input.value));
    const filterByType = this.selectedTypes.size > 0;

    // 3. Gather Selected Combined Customer
    this.selectedCustomers.clear();
    const custSelect = document.getElementById('filter-customer-select');
    if (custSelect && custSelect.value) {
      this.selectedCustomers.add(custSelect.value.toUpperCase());
    }
    const filterByCust = this.selectedCustomers.size > 0;

    const hasActiveFilters = filterByDistrict || filterByType || filterByCust;

    // Update active filter badge indicator
    const filterBadge = document.getElementById('active-filters-count');
    const activeCount = (filterByDistrict ? this.selectedDistricts.size : 0) + 
                        (filterByType ? this.selectedTypes.size : 0) + 
                        (filterByCust ? 1 : 0);
    if (filterBadge) {
      if (activeCount > 0) {
        filterBadge.textContent = activeCount;
        filterBadge.style.display = 'inline-flex';
      } else {
        filterBadge.style.display = 'none';
      }
    }

    if (!hasActiveFilters) {
      this.mapManager.filterMarkers(null);
      this.events.dispatchEvent(new CustomEvent('filtersApplied', {
        detail: { total: this.dataLoader.outlets.length, matching: this.dataLoader.outlets.length }
      }));
      return;
    }

    const matchingOutletIds = new Set();
    const matchingOutlets = [];

    for (const outlet of this.dataLoader.outlets) {
      const distMatch = !filterByDistrict || this.selectedDistricts.has(outlet.distName);
      const typeMatch = !filterByType || this.selectedTypes.has(outlet.outletType);
      const custMatch = !filterByCust || this.selectedCustomers.has((outlet.canonicalCustName || outlet.custName).toUpperCase());

      if (distMatch && typeMatch && custMatch) {
        matchingOutletIds.add(outlet.id);
        matchingOutlets.push(outlet);
      }
    }

    // Update map markers
    this.mapManager.filterMarkers(matchingOutletIds);

    // Zoom to fit filtered outlets
    if (matchingOutlets.length > 0 && matchingOutlets.length < this.dataLoader.outlets.length) {
      const lats = matchingOutlets.map(o => o.lat);
      const lngs = matchingOutlets.map(o => o.lng);
      const bounds = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      ];
      this.mapManager.fitBounds(bounds);
    }

    this.events.dispatchEvent(new CustomEvent('filtersApplied', {
      detail: { total: this.dataLoader.outlets.length, matching: matchingOutletIds.size }
    }));
  }

  /**
   * Resets all filters to default state:
   * ALL DBs checked, types unselected, customer dropdown cleared
   */
  clearFilters() {
    // Reset district checkboxes to CHECKED by default (all DBs present)
    const districtInputs = document.querySelectorAll('input[name="filter-district"]');
    districtInputs.forEach(cb => { cb.checked = true; });

    const typeInputs = document.querySelectorAll('input[name="filter-type"]');
    typeInputs.forEach(cb => { cb.checked = false; });

    const custSelect = document.getElementById('filter-customer-select');
    if (custSelect) {
      custSelect.value = '';
    }

    const custSearchInput = document.getElementById('filter-customer-search-input');
    if (custSearchInput) {
      custSearchInput.value = '';
      this.populateCustomerDropdown('');
    }

    this.selectedDistricts.clear();
    this.selectedTypes.clear();
    this.selectedCustomers.clear();

    const filterBadge = document.getElementById('active-filters-count');
    if (filterBadge) filterBadge.style.display = 'none';

    this.mapManager.filterMarkers(null);

    if (this.dataLoader.stats.bounds) {
      this.mapManager.fitBounds(this.dataLoader.stats.bounds);
    }

    this.events.dispatchEvent(new CustomEvent('filtersApplied', {
      detail: { total: this.dataLoader.outlets.length, matching: this.dataLoader.outlets.length }
    }));
  }

  escapeHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
