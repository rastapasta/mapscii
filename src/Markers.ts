/*
  MapSCII - Terminal Map Viewer

  Markers module - External overlay markers for stdin/GeoJSON input
  Covers: Issue #35 (pipe coords + markers), Issue #97 (plotting markers)

  Input Protocol (NDJSON):
    {"id":"car-1","lat":52.5,"lon":13.4,"color":"#ff0000","glyph":"●","label":"Car 1"}
    {"id":"car-1","delete":true}  // Remove marker

  Also supports:
    - Simple "lat,lon" lines
    - GeoJSON Point/Feature/FeatureCollection
    - Array of [lat, lon] pairs
*/

import x256 from 'x256';
import { hex2rgb } from './utils';

// Marker definition for custom map overlays
export interface Marker {
    id: string;
    lat: number;
    lon: number;
    color?: number;       // 256-color code
    glyph?: string;       // Symbol to display (default: ●)
    label?: string;       // Optional text label
}

// Input format for marker updates (NDJSON)
export interface MarkerInput {
    id?: string;
    lat?: number;
    lon?: number;
    color?: string | number;  // Hex string or 256-color code
    glyph?: string;
    label?: string;
    delete?: boolean;
}

// GeoJSON types for parsing
interface GeoJSONPoint {
    type: 'Point';
    coordinates: [number, number];  // [lon, lat]
}

interface GeoJSONFeature {
    type: 'Feature';
    geometry: GeoJSONPoint;
    properties?: {
        id?: string;
        name?: string;
        label?: string;
        color?: string;
        glyph?: string;
    };
}

interface GeoJSONFeatureCollection {
    type: 'FeatureCollection';
    features: GeoJSONFeature[];
}

type GeoJSONInput = GeoJSONPoint | GeoJSONFeature | GeoJSONFeatureCollection;

// Marker store with efficient lookup and update
export class MarkerStore {
  private markers: Map<string, Marker> = new Map();
  private autoIdCounter: number = 0;

  // Default marker appearance
  private defaultGlyph = '●';
  private defaultColor = x256(hex2rgb('#ff0000'));  // Red

  // Add or update a marker
  upsertMarker(input: MarkerInput): Marker | null {
    if (input.delete && input.id) {
      this.removeMarker(input.id);
      return null;
    }

    if (input.lat === undefined || input.lon === undefined) {
      return null;
    }

    const id = input.id || `marker-${++this.autoIdCounter}`;

    let color = this.defaultColor;
    if (typeof input.color === 'string') {
      color = x256(hex2rgb(input.color));
    } else if (typeof input.color === 'number') {
      color = input.color;
    }

    const marker: Marker = {
      id,
      lat: input.lat,
      lon: input.lon,
      color,
      glyph: input.glyph || this.defaultGlyph,
      label: input.label,
    };

    this.markers.set(id, marker);
    return marker;
  }

  // Remove a marker by ID
  removeMarker(id: string): boolean {
    return this.markers.delete(id);
  }

  // Set all markers at once (replaces existing)
  setMarkers(markers: Marker[]): void {
    this.markers.clear();
    for (const marker of markers) {
      this.markers.set(marker.id, marker);
    }
  }

  // Clear all markers
  clearMarkers(): void {
    this.markers.clear();
  }

  // Get all markers as array
  getMarkers(): Marker[] {
    return Array.from(this.markers.values());
  }

  // Get a specific marker
  getMarker(id: string): Marker | undefined {
    return this.markers.get(id);
  }

  // Get marker count
  get size(): number {
    return this.markers.size;
  }
}

// Parse a single line of input and return marker input(s)
export function parseMarkerLine(line: string): MarkerInput[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Try JSON first (NDJSON format)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      return parseJsonInput(data);
    } catch {
      // Fall through to text parsing
    }
  }

  // Try simple "lat,lon" or "lat lon" format
  const parts = trimmed.split(/[,\s]+/).map(p => parseFloat(p));
  if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return [{ lat: parts[0], lon: parts[1] }];
  }

  return [];
}

// Parse JSON input (object, array, or GeoJSON)
function parseJsonInput(data: GeoJSONInput | GeoJSONInput[] | number[][] | MarkerInput | MarkerInput[]): MarkerInput[] {
  const inputs: MarkerInput[] = [];

  if (Array.isArray(data)) {
    // Array of [lat, lon] pairs or marker objects
    for (const item of data) {
      if (Array.isArray(item) && item.length >= 2 && typeof item[0] === 'number') {
        inputs.push({ lat: item[0], lon: item[1] });
      } else if (typeof item === 'object' && item !== null) {
        inputs.push(...parseJsonInput(item as GeoJSONInput));
      }
    }
    return inputs;
  }

  if (typeof data !== 'object' || data === null) {
    return inputs;
  }

  // GeoJSON handling
  if ('type' in data) {
    if (data.type === 'FeatureCollection' && 'features' in data) {
      const fc = data as GeoJSONFeatureCollection;
      for (const feature of fc.features) {
        if (feature.geometry?.type === 'Point') {
          inputs.push({
            id: feature.properties?.id,
            lat: feature.geometry.coordinates[1],
            lon: feature.geometry.coordinates[0],
            label: feature.properties?.label || feature.properties?.name,
            color: feature.properties?.color,
            glyph: feature.properties?.glyph,
          });
        }
      }
    } else if (data.type === 'Feature' && 'geometry' in data) {
      const feature = data as GeoJSONFeature;
      if (feature.geometry?.type === 'Point') {
        inputs.push({
          id: feature.properties?.id,
          lat: feature.geometry.coordinates[1],
          lon: feature.geometry.coordinates[0],
          label: feature.properties?.label || feature.properties?.name,
          color: feature.properties?.color,
          glyph: feature.properties?.glyph,
        });
      }
    } else if (data.type === 'Point' && 'coordinates' in data) {
      const point = data as GeoJSONPoint;
      inputs.push({
        lat: point.coordinates[1],
        lon: point.coordinates[0],
      });
    }
    return inputs;
  }

  // Direct marker object
  if ('lat' in data && 'lon' in data) {
    inputs.push(data as MarkerInput);
  }

  return inputs;
}

// Parse multi-line input (e.g., from file or stdin buffer)
export function parseMarkersFromText(text: string): MarkerInput[] {
  const inputs: MarkerInput[] = [];

  // Try to parse as a single JSON blob first
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      return parseJsonInput(data);
    } catch {
      // Fall through to line-by-line parsing
    }
  }

  // Parse line by line
  const lines = text.split('\n');
  for (const line of lines) {
    inputs.push(...parseMarkerLine(line));
  }

  return inputs;
}
