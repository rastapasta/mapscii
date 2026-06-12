/*
  MapSCII - Terminal Map Viewer
  Search Box Module

  Provides a search prompt with live dropdown suggestions
  Supports coordinates, geohash, and place name searches
*/

import config from './config';
import { term } from './InputHandler';
import ngeohash from 'ngeohash';

// Interface for Nominatim search results
export interface NominatimResult {
    lat: string;
    lon: string;
    display_name: string;
    type?: string;
    class?: string;
}

// Search history for autocomplete
const searchHistory: string[] = [];

export interface SearchResult {
    type: 'coordinates' | 'geohash' | 'place' | 'cancelled' | 'empty';
    lat?: number;
    lon?: number;
    displayName?: string;
    query?: string;
}

/**
 * Check if a string is a valid geohash
 * Geohashes are base32 encoded strings (1-12 chars) using specific alphabet
 */
function isValidGeohash(str: string): boolean {
  const normalized = str.toLowerCase().trim();
  if (normalized.length < 1 || normalized.length > 12) return false;
  // Geohash alphabet excludes: a, i, l, o (to avoid confusion)
  return /^[0-9bcdefghjkmnpqrstuvwxyz]+$/.test(normalized);
}

/**
 * Decode a geohash string to lat/lon coordinates
 * Returns the center point of the geohash bounding box
 */
function decodeGeohash(geohash: string): { lat: number; lon: number; precision: number } | null {
  const normalized = geohash.toLowerCase().trim();
  if (!isValidGeohash(normalized)) return null;

  try {
    const decoded = ngeohash.decode(normalized);
    return {
      lat: decoded.latitude,
      lon: decoded.longitude,
      precision: normalized.length,
    };
  } catch {
    return null;
  }
}

// State for search
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let searchResults: NominatimResult[] = [];
let selectedResultIdx = 0;

/**
 * Perform geocoding search with Nominatim
 */
async function performSearch(query: string): Promise<void> {
  if (query.length < 3) {
    searchResults = [];
    return;
  }

  // Check if it looks like coordinates
  if (/^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/.test(query.trim())) {
    searchResults = [];
    return;
  }

  // Check if it looks like a geohash (don't search Nominatim for geohashes)
  if (isValidGeohash(query.trim()) && query.trim().length >= 4) {
    searchResults = [];
    return;
  }

  try {
    const encoded = encodeURIComponent(query);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=5&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'MapSCII/1.0 (https://github.com/rastapasta/mapscii)'
        }
      }
    );

    searchResults = await response.json() as NominatimResult[];
    selectedResultIdx = 0;
  } catch {
    searchResults = [];
  }
}

/**
 * Draw search results dropdown
 */
function drawSearchResults(inputY: number): void {
  const cols = config.output.columns;
  const maxWidth = Math.min(cols - 4, 70);

  // Always clear the full result area first (5 lines max)
  for (let i = 0; i < 5; i++) {
    const y = inputY - 1 - i;
    if (y < 1) continue;
    term.moveTo(1, y);
    term.eraseLine();
  }

  if (searchResults.length === 0) return;

  // Draw results above the input line
  for (let i = 0; i < searchResults.length; i++) {
    const result = searchResults[i];
    const y = inputY - 1 - (searchResults.length - 1 - i);
    if (y < 1) continue;

    term.moveTo(1, y);

    const isSelected = i === selectedResultIdx;
    const prefix = isSelected ? '→ ' : '  ';
    const num = `${i + 1}. `;

    // Truncate display name
    let displayName = result.display_name;
    if (displayName.length > maxWidth - 6) {
      displayName = displayName.slice(0, maxWidth - 9) + '...';
    }

    if (isSelected) {
      term.bgGray.white(prefix + num + displayName);
    } else {
      term.dim(prefix + num + displayName);
    }
  }
}

/**
 * Clear search results display
 */
function clearSearchResults(inputY: number): void {
  for (let i = 0; i < 5; i++) {
    const y = inputY - 1 - i;
    if (y < 1) continue;
    term.moveTo(1, y);
    term.eraseLine();
  }
}

/**
 * Show search prompt with dropdown results
 * Returns the search result when user submits or cancels
 */
export function showSearchPrompt(): Promise<SearchResult> {
  searchResults = [];
  selectedResultIdx = 0;

  // Use getter for dynamic input position (handles resize)
  const getInputY = () => config.output.rows;
  let searchText = '';
  let lastSearchText = '';

  // Draw initial prompt
  const promptText = 'Search: ';
  const inputStartX = promptText.length + 1;

  term.moveTo(1, getInputY());
  term.eraseLine();
  term.white(promptText);

  return new Promise<SearchResult>((resolve) => {
    const updateDisplay = () => {
      const inputY = getInputY();
      // Redraw full prompt line
      term.moveTo(1, inputY);
      term.eraseLine();
      term.white(promptText);
      term(searchText);
      drawSearchResults(inputY);
      // Move cursor to end of input
      term.moveTo(inputStartX + searchText.length, inputY);
    };

    const scheduleSearch = () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
      searchTimeout = setTimeout(async () => {
        if (searchText !== lastSearchText && searchText.length >= 3) {
          lastSearchText = searchText;
          await performSearch(searchText);
          updateDisplay();
        }
      }, 300); // 300ms debounce
    };

    const selectResult = (idx: number): SearchResult | null => {
      if (idx >= 0 && idx < searchResults.length) {
        const result = searchResults[idx];
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);

        // Add to history
        const query = result.display_name.split(',')[0];
        if (!searchHistory.includes(query)) {
          searchHistory.unshift(query);
          if (searchHistory.length > 20) searchHistory.pop();
        }

        return {
          type: 'place',
          lat,
          lon,
          displayName: result.display_name,
          query: searchText,
        };
      }
      return null;
    };

    const cleanup = () => {
      term.off('key', keyHandler);
      config.output.off('resize', resizeHandler);
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
      clearSearchResults(getInputY());
    };

    // Handle terminal resize
    const resizeHandler = () => {
      updateDisplay();
    };
    config.output.on('resize', resizeHandler);

    const keyHandler = async (key: string) => {
      if (key === 'ENTER' || key === '\r' || key === '\n') {
        cleanup();

        // If result is selected, return it
        if (searchResults.length > 0) {
          const result = selectResult(selectedResultIdx);
          if (result) {
            resolve(result);
            return;
          }
        }

        // Otherwise check for coordinates
        const trimmed = searchText.trim();
        if (!trimmed) {
          resolve({ type: 'empty' });
          return;
        }

        // Try to parse as coordinates
        const coordMatch = trimmed.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
        if (coordMatch) {
          const lat = parseFloat(coordMatch[1]);
          const lon = parseFloat(coordMatch[2]);
          if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            resolve({
              type: 'coordinates',
              lat,
              lon,
              query: trimmed,
            });
            return;
          }
        }

        // Try to parse as geohash (base32 string, 4-12 chars for meaningful precision)
        const geohashDecoded = decodeGeohash(trimmed);
        if (geohashDecoded && trimmed.length >= 4) {
          resolve({
            type: 'geohash',
            lat: geohashDecoded.lat,
            lon: geohashDecoded.lon,
            displayName: `Geohash: ${trimmed} (precision ${geohashDecoded.precision})`,
            query: trimmed,
          });
          return;
        }

        // Return query for external geocoding
        resolve({
          type: 'place',
          query: trimmed,
        });

      } else if (key === 'ESCAPE') {
        cleanup();
        resolve({ type: 'cancelled' });

      } else if (key === 'UP') {
        if (searchResults.length > 0) {
          selectedResultIdx = Math.max(0, selectedResultIdx - 1);
          updateDisplay();
        }

      } else if (key === 'DOWN') {
        if (searchResults.length > 0) {
          selectedResultIdx = Math.min(searchResults.length - 1, selectedResultIdx + 1);
          updateDisplay();
        }

      } else if (key === 'BACKSPACE' || key === 'DELETE') {
        searchText = searchText.slice(0, -1);
        updateDisplay();
        scheduleSearch();

      } else if (/^[1-5]$/.test(key) && searchResults.length > 0) {
        // Quick select with number keys
        const idx = parseInt(key) - 1;
        if (idx < searchResults.length) {
          cleanup();
          const result = selectResult(idx);
          if (result) {
            resolve(result);
            return;
          }
        }

      } else if (key.length === 1 && !key.startsWith('CTRL')) {
        searchText += key;
        updateDisplay();
        scheduleSearch();
      }
    };

    term.on('key', keyHandler);
  });
}

/**
 * Geocode a query using Nominatim
 */
export async function geocodeQuery(query: string): Promise<NominatimResult | null> {
  try {
    const encoded = encodeURIComponent(query);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`,
      {
        headers: {
          'User-Agent': 'MapSCII/1.0 (https://github.com/rastapasta/mapscii)'
        }
      }
    );

    const results = await response.json() as NominatimResult[];
    return results.length > 0 ? results[0] : null;
  } catch {
    return null;
  }
}
