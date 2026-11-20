# FleetNav Pro — Production Outlet Navigation & Visualization Platform

A high-performance, modular, production-ready web application for visualizing and navigating to a large database of ~4,345 store/outlet locations using **pure HTML5, CSS3, and Vanilla JavaScript (ES6 Modules)**.

🔗 **Live Deployment:** [https://navigation-system3.vercel.app/](https://navigation-system3.vercel.app/)

---

## Key Highlights & Architectural Guarantees

1. **Zero Framework Bloat (Pure Vanilla Stack):** Built strictly with HTML5, CSS3, and modular ES6 JavaScript. No React, Next.js, Vite, or heavy bundling pipelines.
2. **No Mapbox / No Google Maps / No OSM Routing Engine:** Uses Leaflet with high-performance clustering for rendering, combined with **TomTom Web Routing API v1** for live traffic-aware routing.
3. **Free Developer Tier (No Credit Card Required):** TomTom offers **2,500 free routing transactions/day** with simple email registration without requiring credit card details.
4. **Coexistence Guarantee:** When turn-by-turn navigation begins, all 4,345 outlet markers remain visible underneath the route overlay with their customer color coding intact.
5. **Deterministic Customer Colors:** Uses an FNV-1a 32-bit hashing algorithm with golden-ratio HSL color distribution so every customer receives a consistent, high-contrast color across reloads and sessions.
6. **Live Turn-by-Turn Navigation & Recalculation:** High-accuracy GPS tracking (`navigator.geolocation.watchPosition`), cross-track deviation detection, automatic route recalculation without manual buttons, alternative routes switcher, and Web Speech API voice guidance.
7. **Simulation Mode:** Test full driving simulation, maneuver updates, off-route deviations, and instant automatic recalculations directly in the browser.

---

## Project Structure

```
├── index.html                  # Main application markup & HUD layout
├── css/
│   └── style.css               # Modern dark logistics theme, glassmorphism, responsive CSS
├── js/
│   ├── app.js                  # Application bootstrapper and coordinator
│   ├── config.js               # Centralized configuration & localStorage API key store
│   ├── data.js                 # RFC-4180 CSV parser, validator, and stats aggregator
│   ├── colors.js               # Deterministic customer color hashing & contrast system
│   ├── map.js                  # Leaflet map manager, clustering, custom SVG pins & overlays
│   ├── routing.js              # Modular RoutingService interface & TomTom API adapter
│   ├── navigation.js           # Turn-by-turn controller, GPS watch, deviation engine, simulation
│   ├── filters.js              # Multi-attribute filtering (District, Type, Customer)
│   ├── search.js               # Instant multi-field fuzzy search (Name, District, Type, Coords)
│   └── ui.js                   # UI controllers (Customer legend, stats, cards, settings, toasts)
├── data/
│   └── outlets.csv             # Store/outlet dataset (4,345 records)
├── tests/
│   └── test_suite.js           # Automated test suite (44 unit & integration tests)
└── README.md                   # Documentation & setup guide
```

---

## Dual-Server Architecture

The system is organized into two dedicated applications running on separate local servers:

1. **Customer Navigation Dashboard (`http://localhost:8080`)**:
   - Clean, full-screen map interface with zero admin clutter.
   - 4,345 clustered outlet locations with deterministic customer color coding.
   - Turn-by-turn traffic-aware routing, GPS tracking, and automatic route recalculation.
2. **Admin & Dataset Management Portal (`http://localhost:8081`)**:
   - Upload new store databases in **Excel (`.xlsx`, `.xls`)** or **CSV** formats.
   - Choose between **Append / Merge New Stores** or **Replace Entire Database**.
   - Automatic column matching (`DIST_NAME`, `CUST_NAME`, `KEYACCGRP2_DESC`, `LATITUDE`, `LONGITUDE`) with live data validation and error flagging.
   - Interactive preview table with search and pagination.
   - Single store manual insertion form and CSV export.


### Option 1: Python HTTP Server (Built-in)
```bash
# Python 3
python -m http.server 8080
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 2: Node.js (npx serve / http-server)
```bash
npx -y serve -l 8080 .
```

### Option 3: VS Code Live Server
Right-click `index.html` and select **"Open with Live Server"**.

---

## API Configuration & TomTom Setup

### 1. Get a Free TomTom API Key (No Credit Card Required)
1. Visit [developer.tomtom.com](https://developer.tomtom.com/) and register a free account.
2. Go to **Dashboard → My Apps / Keys**.
3. Copy your **API Key**. The free tier provides **2,500 daily routing/map API transactions** with zero billing setup.

### 2. Setting the API Key
You can configure your key in either of two ways:

- **Via In-App Settings Modal (Recommended):**
  Click the **Gear Icon ⚙️** in the top-left sidebar header, paste your API key into the TomTom API Key field, and click **Save Settings**. The key is stored securely in your browser's `localStorage`.
- **Via Configuration File:**
  Open [config/config.js](file:///c:/Users/praty/OneDrive/Desktop/Projects/aadi/navigation-system3/config/config.js) and update:
  ```javascript
  DEFAULT_TOMTOM_API_KEY: 'YOUR_ACTUAL_TOMTOM_API_KEY'
  ```

*Note: If no API key is set, the application automatically runs in High-Fidelity Simulation Mode so you can still test marker clustering, search, filtering, turn-by-turn navigation UI, GPS movement, and auto-recalculation without interruptions.*

---

## How to Replace or Add Another Routing Provider

The application is built on a **Provider-Agnostic Adapter Pattern**. All routing logic communicates through the standardized `RoutingService` interface.

### Step 1: Create a New Adapter in `js/routing.js`
Implement `BaseRoutingProvider`:

```javascript
import { BaseRoutingProvider, RouteResult } from './routing.js';

export class CustomRoutingAdapter extends BaseRoutingProvider {
  async calculateRoute(origin, destination, options = {}) {
    // 1. Make your HTTP request to the new provider
    const response = await fetch(`https://api.yourprovider.com/route?from=${origin.lat},${origin.lng}&to=${destination.lat},${destination.lng}`);
    const data = await response.json();

    // 2. Map coordinates, summary, and instructions into standardized RouteResult
    const primaryRoute = new RouteResult({
      id: 'custom-route-0',
      name: 'Custom Fastest Route',
      isPrimary: true,
      distanceMeters: data.total_distance,
      travelTimeSeconds: data.total_time,
      trafficDelaySeconds: data.traffic_delay || 0,
      coordinates: data.geometry_points, // Array of [lat, lng]
      instructions: data.turn_instructions,
      trafficAware: true,
      provider: 'CustomProvider'
    });

    return {
      primaryRoute,
      alternativeRoutes: [],
      allRoutes: [primaryRoute],
      trafficAware: true
    };
  }
}
```

### Step 2: Register the Adapter in `js/routing.js` or `js/app.js`
```javascript
import { routingService } from './routing.js';
import { CustomRoutingAdapter } from './custom_routing_adapter.js';

routingService.setAdapter(new CustomRoutingAdapter());
```

---

## Deployment Instructions

Because the application consists entirely of static HTML, CSS, and JavaScript files, it can be deployed to any static hosting provider in seconds:

### 1. GitHub Pages
1. Push the repository to GitHub.
2. In your repository settings, go to **Pages**.
3. Under **Branch**, select `main` and root `/`, then click **Save**.

### 2. Netlify / Vercel / Cloudflare Pages
1. Drag and drop the project folder into Netlify Drop, or link your Git repository.
2. Build command: *(leave blank)*
3. Publish directory: `.` (root).

### 3. Nginx / Apache
Copy all project files to `/var/www/html/` or your webroot directory. Ensure MIME type `application/javascript` is configured for `.js` files.

---

## Running the Automated Test Suite

A comprehensive test suite is included in `tests/test_suite.js`. It validates all 44 test cases across data parsing, customer color hashing, routing calculations, deviation mathematics, and server connectivity.

```bash
node tests/test_suite.js
```
