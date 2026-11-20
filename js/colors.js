/**
 * Deterministic Customer Color Management System
 * Uses FNV-1a 32-bit hashing combined with the golden ratio hue distribution
 * to assign visually distinct, stable, and reproducible colors to every unique CUST_NAME.
 */

class ColorManager {
  constructor() {
    this.colorCache = new Map();
    // Golden ratio conjugate to scatter hues evenly around the 360-degree color wheel
    this.GOLDEN_RATIO_CONJUGATE = 0.618033988749895;
  }

  /**
   * 32-bit FNV-1a hash algorithm
   * @param {string} str
   * @returns {number} 32-bit unsigned integer
   */
  fnv1a(str) {
    let hash = 2166136261;
    const cleanStr = (str || '').trim().toUpperCase();
    for (let i = 0; i < cleanStr.length; i++) {
      hash ^= cleanStr.charCodeAt(i);
      // 32-bit FNV prime multiplication
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Generates a deterministic, visually appealing color for any customer name.
   * @param {string} customerName
   * @returns {object} { hex, hsl, rgb, rgba, textContrastColor, hue }
   */
  getColorForCustomer(customerName) {
    const key = (customerName || 'UNKNOWN').trim();
    if (this.colorCache.has(key)) {
      return this.colorCache.get(key);
    }

    const hash = this.fnv1a(key);

    // Compute hue using golden ratio spacing for maximum distinctness
    const normalizedHash = (hash % 100000) / 100000;
    const hue = Math.floor(((normalizedHash + this.GOLDEN_RATIO_CONJUGATE * (hash % 360)) % 1) * 360);

    // Variate saturation (78% to 92%) and lightness (50% to 62%) for contrast & variety
    const satOffset = (hash >> 8) % 15;
    const saturation = 78 + satOffset; // 78% - 93%

    const lightOffset = (hash >> 16) % 12;
    const lightness = 52 + lightOffset; // 52% - 64%

    const hsl = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    const hex = this.hslToHex(hue, saturation, lightness);
    const rgb = this.hslToRgb(hue, saturation, lightness);
    const rgba = (alpha = 0.25) => `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;

    // Calculate perceived luminance to choose white or dark text for badges
    // Relative luminance: 0.2126*R + 0.7152*G + 0.0722*B
    const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
    const textContrastColor = luminance > 0.6 ? '#111827' : '#ffffff';

    const colorObj = {
      customerName: key,
      hue,
      saturation,
      lightness,
      hsl,
      hex,
      rgb,
      rgba,
      textContrastColor
    };

    this.colorCache.set(key, colorObj);
    return colorObj;
  }

  /**
   * Helper: Convert HSL values to Hex color string
   */
  hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /**
   * Helper: Convert HSL to RGB object
   */
  hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return {
      r: Math.round(255 * f(0)),
      g: Math.round(255 * f(8)),
      b: Math.round(255 * f(4))
    };
  }

  /**
   * Clear cache if required
   */
  clearCache() {
    this.colorCache.clear();
  }
}

export const colorManager = new ColorManager();
