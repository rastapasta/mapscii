/*
  MapSCII - Terminal Map Viewer
  Globe Module - 3D Spherical Projection

  Provides a 3D globe rendering mode that integrates with the existing
  Renderer and Canvas system. When globe mode is enabled, all coordinates
  are projected onto a sphere before being rendered.

  Features:
  - Uses the same tile source and styling as flat map
  - Full mouse support (drag to rotate, scroll to zoom)
  - Full keyboard support (same as flat map)
  - Renders with braille characters
  - Shows the same markers, labels, and POIs
*/

import config from './config';
import * as utils from './utils';
import Canvas, { Point } from './Canvas';
import earcut from 'earcut';
import stringWidth from 'string-width';

export interface GlobeProjection {
    /** Center latitude of the view (what's facing the camera) */
    centerLat: number;
    /** Center longitude of the view */
    centerLon: number;
    /** Sphere radius in screen pixels */
    radius: number;
    /** Screen width */
    width: number;
    /** Screen height */
    height: number;
}

/**
 * Globe coordinate transformer
 *
 * Transforms lat/lon coordinates to screen coordinates using spherical projection.
 * Points on the back of the sphere are culled.
 */
export class GlobeTransformer {
  private centerLat: number = 0;
  private centerLon: number = 0;
  private radius: number = 100;
  private width: number = 0;
  private height: number = 0;
  // Terminal chars are 2 internal pixels wide, 4 internal pixels tall
  // To make a circle appear round, we need to stretch X
  // If Y uses full radius, then X should use radius * (4/2) = radius * 2
  // But wait, we work in internal pixels, so just use 1.0 and let the canvas handle it
  private readonly aspectRatio: number = 1.0;

  // Pre-computed sin/cos for rotation
  private cosLat: number = 1;
  private sinLat: number = 0;
  private cosLon: number = 1;
  private sinLon: number = 0;

  constructor() { }

  /**
     * Update projection parameters
     */
  setProjection(proj: GlobeProjection): void {
    this.centerLat = proj.centerLat;
    this.centerLon = proj.centerLon;
    this.radius = proj.radius;
    this.width = proj.width;
    this.height = proj.height;

    // Pre-compute rotation matrices
    const latRad = (this.centerLat * Math.PI) / 180;
    const lonRad = (this.centerLon * Math.PI) / 180;
    this.cosLat = Math.cos(latRad);
    this.sinLat = Math.sin(latRad);
    this.cosLon = Math.cos(lonRad);
    this.sinLon = Math.sin(lonRad);
  }

  /**
     * Get current projection settings
     */
  getProjection(): GlobeProjection {
    return {
      centerLat: this.centerLat,
      centerLon: this.centerLon,
      radius: this.radius,
      width: this.width,
      height: this.height,
    };
  }

  /**
     * Convert lat/lon to 3D cartesian coordinates on unit sphere
     */
  latLonTo3D(lat: number, lon: number): { x: number; y: number; z: number } {
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;

    return {
      x: Math.cos(latRad) * Math.sin(lonRad),
      y: Math.sin(latRad),
      z: Math.cos(latRad) * Math.cos(lonRad),
    };
  }

  /**
     * Apply view rotation to a 3D point
     */
  rotate(p: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    // Rotate around Y axis (longitude)
    let x = p.x * this.cosLon - p.z * this.sinLon;
    let z = p.x * this.sinLon + p.z * this.cosLon;

    // Rotate around X axis (latitude)
    const y = p.y * this.cosLat - z * this.sinLat;
    z = p.y * this.sinLat + z * this.cosLat;

    return { x, y, z };
  }

  /**
     * Project a lat/lon point to screen coordinates
     * Returns null if the point is on the back of the sphere (not visible)
     */
  project(lat: number, lon: number): { x: number; y: number; z: number } | null {
    const p3d = this.latLonTo3D(lat, lon);
    const rotated = this.rotate(p3d);

    // Cull back-facing points
    if (rotated.z < 0) return null;

    // Project to screen
    const screenX = this.width / 2 + rotated.x * this.radius * this.aspectRatio;
    const screenY = this.height / 2 - rotated.y * this.radius;

    return {
      x: screenX,
      y: screenY,
      z: rotated.z, // Depth for potential z-ordering
    };
  }

  /**
     * Convert screen position back to lat/lon (for mouse interaction)
     */
  screenToLatLon(screenX: number, screenY: number): { lat: number; lon: number } | null {
    // Normalize to sphere coordinates
    const nx = (screenX - this.width / 2) / (this.radius * this.aspectRatio);
    const ny = -(screenY - this.height / 2) / this.radius;

    const d2 = nx * nx + ny * ny;
    if (d2 > 1) return null; // Outside sphere

    const nz = Math.sqrt(1 - d2);

    // Reverse rotation
    let x = nx, y = ny, z = nz;

    // Reverse latitude rotation
    const latRad = (-this.centerLat * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    const newY = y * cosLat - z * sinLat;
    z = y * sinLat + z * cosLat;
    y = newY;

    // Reverse longitude rotation
    const lonRad = (-this.centerLon * Math.PI) / 180;
    const cosLon = Math.cos(lonRad);
    const sinLon = Math.sin(lonRad);
    const newX = x * cosLon - z * sinLon;
    z = x * sinLon + z * cosLon;
    x = newX;

    return {
      lat: (Math.asin(y) * 180) / Math.PI,
      lon: (Math.atan2(x, z) * 180) / Math.PI,
    };
  }

}

// ============================================================================
// Interactive Globe View
// ============================================================================

import x256 from 'x256';
import Styler, { MapStyle } from './Styler';
import LabelBuffer from './LabelBuffer';
import TileSource, { TileNotFoundError } from './TileSource';
import { term } from './InputHandler';
import { hex2rgb, baseZoom, ll2tile, tile2ll, LatLon, normalize } from './utils';
import { TileFeature, TileLayer } from './Tile';
import { clipPolylineToRect } from './clipping';
import { generateDrawOrder, isLabelLayer } from './drawOrder';

interface GlobeMarker {
    lat: number;
    lon: number;
    glyph: string;
    color?: number;
    label?: string;
}

interface GlobeViewOptions {
    centerLat: number;
    centerLon: number;
    zoom: number;
    markers?: GlobeMarker[];
    tileSource: TileSource;
    style: MapStyle;
}

interface GlobeState {
    centerLat: number;
    centerLon: number;
    zoom: number;  // Controls which tile zoom level to use (detail)
    globeScale: number;  // Scale of the globe (1.0 = normal)
}

interface GlobeDebugState {
    enabled: boolean;
    tiles: boolean;
    triangles: boolean;
    horizon: boolean;
}

interface GlobeLabelJob {
    feature: TileFeature;
    text: string;
    color: number;
    candidates: Point[];
}

const DEBUG_TILE_COLOR = 46;
const DEBUG_TRIANGLE_COLOR = 201;
const DEBUG_HORIZON_COLOR = 196;
const DEBUG_HORIZON_TOL = 1e-4;
const MERCATOR_MAX_LAT = 85.0511;

/**
 * Collect visible tiles by sampling the screen and determining which tiles are needed
 */
interface VisibleTile {
    x: number;
    y: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function collectVisibleTiles(
  transformer: GlobeTransformer,
  tileZ: number,
  width: number,
  height: number
): VisibleTile[] {
  const seen = new Set<string>();
  const tiles: VisibleTile[] = [];
  const bounds = new Map<string, VisibleTile>();
  const n = 1 << tileZ;

  // Sample screen pixels to find which tiles are visible
  // Use finer sampling at high zoom to catch all tiles
  const step = Math.max(2, Math.min(8, Math.floor(16 / Math.max(1, tileZ / 4))));
  for (let sy = 0; sy < height; sy += step) {
    for (let sx = 0; sx < width; sx += step) {
      const ll = transformer.screenToLatLon(sx, sy);
      if (!ll) continue;

      const t = ll2tile(ll.lon, ll.lat, tileZ);
      // WebMercator: X wraps, Y clamps
      const rawTx = Math.floor(t.x);
      const rawTy = Math.floor(t.y);
      const tx = ((rawTx % n) + n) % n;
      const ty = Math.max(0, Math.min(n - 1, rawTy));
      const fx = t.x - rawTx;
      const fy = t.y - rawTy;

      const key = `${tx},${ty}`;
      let entry = bounds.get(key);
      if (!entry) {
        entry = { x: tx, y: ty, minX: fx, maxX: fx, minY: fy, maxY: fy };
        bounds.set(key, entry);
        seen.add(key);
        tiles.push(entry);
      } else {
        entry.minX = Math.min(entry.minX, fx);
        entry.maxX = Math.max(entry.maxX, fx);
        entry.minY = Math.min(entry.minY, fy);
        entry.maxY = Math.max(entry.maxY, fy);
      }
    }
  }

  // If no tiles found (very zoomed in), use center point
  if (tiles.length === 0) {
    const centerLL = transformer.screenToLatLon(width / 2, height / 2);
    if (centerLL) {
      const t = ll2tile(centerLL.lon, centerLL.lat, tileZ);
      const rawTx = Math.floor(t.x);
      const rawTy = Math.floor(t.y);
      const tx = ((rawTx % n) + n) % n;
      const ty = Math.max(0, Math.min(n - 1, rawTy));
      const fx = t.x - rawTx;
      const fy = t.y - rawTy;
      const key = `${tx},${ty}`;
      const entry = { x: tx, y: ty, minX: fx, maxX: fx, minY: fy, maxY: fy };
      tiles.push(entry);
      bounds.set(key, entry);
      seen.add(key);
    }
  }

  // Add neighboring tiles for each visible tile (padding)
  const padding = tileZ >= 8 ? 0 : 1;
  if (padding <= 0) {
    return tiles;
  }

  const padded: VisibleTile[] = [];
  for (const t of tiles) {
    for (let dy = -padding; dy <= padding; dy++) {
      for (let dx = -padding; dx <= padding; dx++) {
        const nx = ((t.x + dx) % n + n) % n;
        const ny = t.y + dy;
        if (ny >= 0 && ny < n) {
          const key = `${nx},${ny}`;
          if (!seen.has(key)) {
            seen.add(key);
            const entry = { x: nx, y: ny, minX: 0, maxX: 1, minY: 0, maxY: 1 };
            bounds.set(key, entry);
            padded.push(entry);
          }
        }
      }
    }
  }

  return [...tiles, ...padded];
}

/**
 * Layer draw order for the globe - shared with the flat Renderer so paint
 * order (e.g. water vs. landcover) stays consistent between the two views.
 */
function globeDrawOrder(zoom: number): string[] {
  const layers = generateDrawOrder(zoom);
  if (config.noLabels) {
    return layers.filter((layer) => !isLabelLayer(layer));
  }
  return layers;
}

function resolveStyleColor(color: string | { stops: [number, string][] } | undefined): string | undefined {
  if (!color) return undefined;
  if (typeof color === 'string') return color;
  if ('stops' in color && Array.isArray(color.stops) && color.stops.length > 0) {
    return color.stops[0][1];
  }
  return undefined;
}

/**
 * Show an interactive 3D globe view
 * Returns a promise that resolves when the user exits globe mode
 */
export async function showGlobeView(options: GlobeViewOptions): Promise<void> {
  return new Promise((resolve) => {
    // Mutable dimensions that update on resize
    let width = (process.stdout.columns || 80) * 2;
    let height = ((process.stdout.rows || 24) - 1) * 4;

    let canvas = new Canvas(width, height);
    const transformer = new GlobeTransformer();
    const styler = new Styler(options.style);
    options.tileSource.useStyler(styler);

    // Increase tile cache for globe view (kept moderate: parsed tiles with
    // rbush trees and triangulation caches are memory-heavy)
    const prevCacheSize = options.tileSource.cacheSize;
    options.tileSource.cacheSize = Math.max(prevCacheSize, 128);

    // Fixed globe radius (in internal pixels) - doesn't change with screen size
    const baseRadius = 80;  // Fixed radius for consistent globe size

    const initialZoom = Number.isFinite(options.zoom) ? options.zoom : 0;
    const worldPx = config.projectSize * Math.pow(2, initialZoom);
    const halfWidth = width / 2;
    const halfWidthDeg = (halfWidth * 360) / worldPx;
    const halfWidthRad = utils.deg2rad(Math.min(90, halfWidthDeg));
    const desiredRadius = halfWidthRad > 0 ? (halfWidth / Math.sin(halfWidthRad)) : baseRadius;
    const initialScale = Math.min(100000.0, Math.max(0.3, desiredRadius / baseRadius));
    const scaleBaseline = initialScale;
    const baseTileZoom = Math.min(baseZoom(initialZoom), 18);

    const initialCenter = normalize({ lat: options.centerLat, lon: options.centerLon });
    const state: GlobeState = {
      centerLat: initialCenter.lat,
      centerLon: initialCenter.lon,
      // Use map zoom for tile detail base
      zoom: baseTileZoom,
      globeScale: initialScale,
    };

    const debug: GlobeDebugState = {
      enabled: false,
      tiles: false,
      triangles: false,
      horizon: false,
    };

    const labelBuffer = new LabelBuffer();
    const textWidthCache = new Map<string, number>();
    const getTextWidth = (text: string): number => {
      const cached = textWidthCache.get(text);
      if (cached !== undefined) return cached;
      const w = Math.max(1, stringWidth(text));
      if (textWidthCache.size > 4096) textWidthCache.clear();
      textWidthCache.set(text, w);
      return w;
    };

    const ensureDebugDefaults = () => {
      if (!debug.tiles && !debug.triangles && !debug.horizon) {
        debug.tiles = true;
        debug.triangles = true;
        debug.horizon = true;
      }
    };

    // Runtime cap that can shrink if we detect missing zoom levels
    let runtimeMaxTileZoom = options.tileSource.getMaxZoom();

    let drawToken = 0;

    // Mouse state for dragging
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    // Initialize transformer
    transformer.setProjection({
      centerLat: state.centerLat,
      centerLon: state.centerLon,
      radius: baseRadius * state.globeScale,
      width,
      height,
    });

    // Draw function
    const draw = async () => {
      const token = ++drawToken;
      const isStale = () => token !== drawToken;

      // Update transformer projection
      transformer.setProjection({
        centerLat: state.centerLat,
        centerLon: state.centerLon,
        radius: baseRadius * state.globeScale,
        width,
        height,
      });

      // Get background color from style
      const bgStyle = styler.styleById['background'];
      const bgColor = bgStyle?.paint?.['background-color'];
      if (bgColor) {
        canvas.setBackground(x256(hex2rgb(bgColor)));
      }
      canvas.clear();
      labelBuffer.clear();
      const labelJobs: GlobeLabelJob[] = [];

      const proj = transformer.getProjection();
      const waterStyle = styler.styleById['water'];
      const waterColorValue = resolveStyleColor(waterStyle?.paint?.['fill-color']);
      const waterColor = waterColorValue ? x256(hex2rgb(waterColorValue)) : undefined;
      if (waterColor !== undefined) {
        drawPolarCap(canvas, transformer, proj, MERCATOR_MAX_LAT, waterColor);
      }

      // Calculate which tiles we need based on scale and zoom
      // At globe scale 1.0, use very low zoom (0) to see whole Earth
      // As we zoom in with higher scale, increase tile detail gradually
      // log2(1.0) = 0, log2(10) ≈ 3.3, log2(100) ≈ 6.6
      // We want: scale 1 -> zoom 0, scale 10 -> zoom 3, scale 100 -> zoom 6, scale 1000 -> zoom 10
      // IMPORTANT: use floor so we don't jump early to a zoom level that may not exist
      const scaleRatio = Math.max(1e-6, state.globeScale / scaleBaseline);
      const scaleZoomBonus = Math.floor(Math.log2(scaleRatio));
      const baseGlobeZoom = state.zoom;
      let tileZoom = Math.max(0, Math.min(baseGlobeZoom + scaleZoomBonus, runtimeMaxTileZoom));

      // Probe: if this zoom doesn't exist in the tileset, clamp down until it does.
      // (This fixes "black past X" even if getMaxZoom() is wrong.)
      // Only a definitive TileNotFoundError lowers the cap - transient
      // network/parse errors must NOT permanently degrade detail.
      const centerLL = transformer.screenToLatLon(width / 2, height / 2);
      if (centerLL) {
        while (tileZoom > 0) {
          const n = 1 << tileZoom;
          const tt = ll2tile(centerLL.lon, centerLL.lat, tileZoom);
          const tx = ((Math.floor(tt.x) % n) + n) % n;
          const ty = Math.max(0, Math.min(n - 1, Math.floor(tt.y)));
          try {
            await options.tileSource.getTile(tileZoom, tx, ty);
            break; // zoom level exists
          } catch (e) {
            if (e instanceof TileNotFoundError) {
              runtimeMaxTileZoom = tileZoom - 1;
              tileZoom = Math.min(tileZoom, runtimeMaxTileZoom);
              continue;
            }
            // Transient failure: keep the zoom, per-tile fallback copes
            break;
          }
        }
      }

      const drawOrder = globeDrawOrder(tileZoom);

      // Only fetch tiles actually needed for visible hemisphere
      const needed = collectVisibleTiles(transformer, tileZoom, width, height);

      // Load and render tiles
      const tilePromises: Promise<void>[] = [];
      for (const t of needed) {
        tilePromises.push(
          renderGlobeTile(
            canvas,
            transformer,
            options.tileSource,
            t.x,
            t.y,
            tileZoom,
            drawOrder,
            isStale,
            debug,
            labelJobs,
            { minX: t.minX, minY: t.minY, maxX: t.maxX, maxY: t.maxY }
          )
        );
      }

      try {
        await Promise.all(tilePromises);
      } catch {
        // Ignore tile errors
      }

      if (isStale()) return;

      if (debug.enabled && debug.tiles) {
        for (const t of needed) {
          drawTileOutline(canvas, transformer, t.x, t.y, tileZoom, DEBUG_TILE_COLOR);
        }
      }

      // Draw globe outline (edge of the sphere)
      drawGlobeEdge(canvas, width, height, baseRadius * state.globeScale, 250);

      if (!config.noLabels && labelJobs.length > 0) {
        labelJobs.sort((a, b) => (a.feature.sort || 0) - (b.feature.sort || 0));
        const seenPlaces = new Set<string>();
        for (const job of labelJobs) {
          const labelText = job.feature.label;
          if (labelText && job.feature.layer === 'place') {
            const key = `${job.feature.layer}|${labelText}`;
            if (seenPlaces.has(key)) continue;
            seenPlaces.add(key);
          }

          const layerConfig = config.layers[job.feature.layer];
          const margin = layerConfig?.margin ?? config.labelMargin;
          const textWidth = getTextWidth(job.text);
          const xOffset = Math.floor(textWidth / 2) * 2;
          const cluster = layerConfig?.cluster;

          for (const candidate of job.candidates) {
            const labelX = candidate.x - xOffset;
            if (labelBuffer.writeIfPossible(job.text, labelX, candidate.y, job.feature, margin)) {
              canvas.text(job.text, labelX, candidate.y, job.color);
              break;
            }
            if (cluster) {
              if (labelBuffer.writeIfPossible(config.poiMarker, candidate.x, candidate.y, job.feature, 3)) {
                canvas.text(config.poiMarker, candidate.x, candidate.y, job.color);
                break;
              }
            }
          }
        }
      }

      // Draw markers
      if (options.markers) {
        for (const marker of options.markers) {
          const projected = transformer.project(marker.lat, marker.lon);
          if (projected && projected.z > 0) {
            const color = marker.color ?? x256(hex2rgb('#ff0000'));
            canvas.text(marker.glyph, Math.round(projected.x), Math.round(projected.y), color);
            if (marker.label) {
              canvas.text(marker.label, Math.round(projected.x) + 4, Math.round(projected.y), color);
            }
          }
        }
      }

      // Output frame
      const frame = '\x1B[2J\x1B[H' + canvas.frame();
      term.noFormat(frame);

      // Show footer
      term.moveTo(1, process.stdout.rows || 24);
      term.eraseLine();
      term.noFormat(`Globe: ${state.centerLat.toFixed(1)}°, ${state.centerLon.toFixed(1)}° | TileZ: ${tileZoom} | Scale: ${state.globeScale.toFixed(1)}x | Arrows/drag: rotate | +/-: zoom | Q: exit | Debug: ${debug.enabled ? 'on' : 'off'} (D,1,2,3)`);
    };

    // Coalesce redraws: input events (especially mouse drags) arrive much
    // faster than frames can render. Keep at most one frame in flight and
    // one pending - the pending frame always renders the latest state.
    let drawing = false;
    let pendingDraw = false;
    const requestDraw = () => {
      if (drawing) {
        pendingDraw = true;
        return;
      }
      drawing = true;
      void draw()
        .catch(() => { /* never let a failed frame block future ones */ })
        .finally(() => {
          drawing = false;
          if (pendingDraw) {
            pendingDraw = false;
            requestDraw();
          }
        });
    };

    // Initial draw
    requestDraw();

    // Handle keyboard input
    const onKey = (key: string) => {
      let needsDraw = true;
      const rotateStep = 10;

      switch (key) {
        case 'd':
        case 'D':
          debug.enabled = !debug.enabled;
          if (debug.enabled) ensureDebugDefaults();
          break;
        case '1':
          debug.tiles = !debug.tiles;
          debug.enabled = true;
          break;
        case '2':
          debug.triangles = !debug.triangles;
          debug.enabled = true;
          break;
        case '3':
          debug.horizon = !debug.horizon;
          debug.enabled = true;
          break;
        case 'q':
        case 'ESCAPE':
        case 'CTRL_C':
          cleanup();
          resolve();
          return;
        case 'LEFT':
          state.centerLon = normalize({ lat: 0, lon: state.centerLon - rotateStep }).lon;
          break;
        case 'RIGHT':
          state.centerLon = normalize({ lat: 0, lon: state.centerLon + rotateStep }).lon;
          break;
        case 'UP':
          state.centerLat = (state.centerLat + rotateStep) % 360;
          if (state.centerLat > 180) state.centerLat -= 360;
          break;
        case 'DOWN':
          state.centerLat = (state.centerLat - rotateStep) % 360;
          if (state.centerLat < -180) state.centerLat += 360;
          break;
        case '+':
        case '=':
        case 'a':
          state.globeScale = Math.min(100000.0, state.globeScale * 1.2);
          break;
        case '-':
        case 'z':
        case 'y':
          state.globeScale = Math.max(0.3, state.globeScale / 1.2);
          break;
        case 'h':
          state.centerLon = normalize({ lat: 0, lon: state.centerLon - rotateStep }).lon;
          break;
        case 'l':
          state.centerLon = normalize({ lat: 0, lon: state.centerLon + rotateStep }).lon;
          break;
        case 'k':
          state.centerLat = (state.centerLat + rotateStep) % 360;
          if (state.centerLat > 180) state.centerLat -= 360;
          break;
        case 'j':
          state.centerLat = (state.centerLat - rotateStep) % 360;
          if (state.centerLat < -180) state.centerLat += 360;
          break;
        default:
          needsDraw = false;
      }

      if (needsDraw) {
        requestDraw();
      }
    };

    // Handle mouse events
    const onMouse = (name: string, data: { x: number; y: number; shift?: boolean }) => {
      const zoomAt = (factor: number) => {
        const mx = Math.round((data.x - 0.5) * 2);
        const my = Math.round((data.y - 0.5) * 4);
        const cx = Math.max(0, Math.min(width - 1, mx));
        const cy = Math.max(0, Math.min(height - 1, my));

        const before = transformer.screenToLatLon(cx, cy);
        state.globeScale = Math.min(100000.0, Math.max(0.3, state.globeScale * factor));

        transformer.setProjection({
          centerLat: state.centerLat,
          centerLon: state.centerLon,
          radius: baseRadius * state.globeScale,
          width,
          height,
        });

        if (before) {
          const after = transformer.screenToLatLon(cx, cy);
          if (after) {
            // Same inversion the drag handler applies: past the poles,
            // moving centerLon shifts the lon under the cursor the other way
            const latAbs = Math.abs(state.centerLat % 180);
            const isUpsideDown = latAbs > 90;
            const deltaLat = before.lat - after.lat;
            const deltaLon = (before.lon - after.lon) * (isUpsideDown ? -1 : 1);
            state.centerLon = normalize({ lat: 0, lon: state.centerLon + deltaLon }).lon;
            state.centerLat = (state.centerLat + deltaLat) % 360;
            if (state.centerLat > 180) state.centerLat -= 360;
            if (state.centerLat < -180) state.centerLat += 360;
          }
        }

        requestDraw();
      };

      if (name === 'MOUSE_LEFT_BUTTON_PRESSED') {
        isDragging = true;
        lastMouseX = data.x;
        lastMouseY = data.y;
      } else if (name === 'MOUSE_LEFT_BUTTON_RELEASED') {
        isDragging = false;
      } else if (name === 'MOUSE_DRAG' && isDragging) {
        const dx = data.x - lastMouseX;
        const dy = data.y - lastMouseY;

        // Convert screen movement to rotation degrees
        // Adjust sensitivity based on globe scale so the globe follows the mouse exactly
        const baseSensitivity = 1.5;
        const sensitivity = baseSensitivity / state.globeScale;

        // Y needs extra sensitivity because terminal chars are taller than wide
        const ySensitivityMultiplier = 2.0;

        // When past the poles (lat > 90 or < -90), invert X direction
        const latAbs = Math.abs(state.centerLat % 180);
        const isUpsideDown = latAbs > 90;
        const lonDelta = isUpsideDown ? dx * sensitivity : -dx * sensitivity;
        const latDelta = dy * sensitivity * ySensitivityMultiplier;

        state.centerLon = normalize({ lat: 0, lon: state.centerLon + lonDelta }).lon;
        state.centerLat = (state.centerLat + latDelta) % 360;
        if (state.centerLat > 180) state.centerLat -= 360;
        if (state.centerLat < -180) state.centerLat += 360;

        lastMouseX = data.x;
        lastMouseY = data.y;
        requestDraw();
      } else if (name === 'MOUSE_WHEEL_UP') {
        zoomAt(1.2);
      } else if (name === 'MOUSE_WHEEL_DOWN') {
        zoomAt(1 / 1.2);
      }
    };

    // Register input handlers
    term.on('key', onKey);
    term.on('mouse', onMouse);

    // Cleanup function
    const cleanup = () => {
      term.off('key', onKey);
      term.off('mouse', onMouse);
      process.stdout.off('resize', onResize);
      options.tileSource.cacheSize = prevCacheSize;
    };

    // Handle resize - update dimensions and canvas
    const onResize = () => {
      width = (process.stdout.columns || 80) * 2;
      height = ((process.stdout.rows || 24) - 1) * 4;
      canvas = new Canvas(width, height);
      requestDraw();
    };
    process.stdout.on('resize', onResize);
  });
}

/**
 * Render a single tile onto the globe
 */
async function renderGlobeTile(
  canvas: Canvas,
  transformer: GlobeTransformer,
  tileSource: TileSource,
  tileX: number,
  tileY: number,
  tileZ: number,
  drawOrder: string[],
  isStale?: () => boolean,
  debug?: GlobeDebugState,
  labelJobs?: GlobeLabelJob[],
  tileBounds?: { minX: number; minY: number; maxX: number; maxY: number }
): Promise<void> {
  try {
    if (isStale?.()) return;
    // Safety net: if a zoom is missing, fall back to parent tiles (overzoom).
    // This prevents "all black" when requesting unsupported tileZ.
    let z = tileZ;
    let x = tileX;
    let y = tileY;
    // Keep the visible window valid through the fallback by mapping it
    // into parent-tile coordinates at every step. Without this, a missing
    // child tile caused the WHOLE parent tile to render unbounded.
    let bounds = tileBounds ? { ...tileBounds } : null;
    let tileData: { layers?: Record<string, TileLayer> } | null = null;
    while (z >= 0) {
      if (isStale?.()) return;
      try {
        tileData = await tileSource.getTile(z, x, y);
      } catch {
        tileData = null;
      }
      if (isStale?.()) return;
      const layerCount = tileData?.layers ? Object.keys(tileData.layers).length : 0;
      if (layerCount > 0) break;
      if (bounds) {
        bounds = {
          minX: ((x & 1) + bounds.minX) / 2,
          maxX: ((x & 1) + bounds.maxX) / 2,
          minY: ((y & 1) + bounds.minY) / 2,
          maxY: ((y & 1) + bounds.maxY) / 2,
        };
      }
      z -= 1;
      x = x >> 1;
      y = y >> 1;
    }
    const layers = tileData?.layers;
    if (!layers || Object.keys(layers).length === 0) return;

    // Render layers in proper order
    const order = (z === tileZ) ? drawOrder : globeDrawOrder(z);
    for (const layerId of order) {
      if (isStale?.()) return;
      const layer = layers[layerId] as TileLayer | undefined;
      if (!layer || !layer.tree) continue;

      const extent = layer.extent || 4096;
      const padding = Math.max(8, Math.round(extent * (z >= 10 ? 0.02 : 0.05)));
      const searchBounds = bounds
        ? {
          minX: Math.max(0, Math.floor(bounds.minX * extent - padding)),
          minY: Math.max(0, Math.floor(bounds.minY * extent - padding)),
          maxX: Math.min(extent, Math.ceil(bounds.maxX * extent + padding)),
          maxY: Math.min(extent, Math.ceil(bounds.maxY * extent + padding)),
        }
        : { minX: 0, minY: 0, maxX: extent, maxY: extent };

      // Get only features that intersect the visible tile region
      const features = layer.tree.search(searchBounds);

      for (const feature of features) {
        if (isStale?.()) return;
        renderGlobeFeature(canvas, transformer, feature, x, y, z, extent, debug, labelJobs);
      }
    }
  } catch {
    // Tile load error
  }
}

function collectSymbolCandidates(
  points: Point[],
  tileToLatLon: (px: number, py: number) => LatLon,
  transformer: GlobeTransformer,
  width: number,
  height: number
): Point[] {
  const n = points.length;
  if (n === 0) return [];

  const proj = transformer.getProjection();
  const idxs: number[] = [];
  const pushIdx = (i: number) => {
    if (i < 0 || i >= n) return;
    if (idxs.indexOf(i) !== -1) return;
    idxs.push(i);
  };

  pushIdx(Math.floor(n / 2));
  pushIdx(Math.floor(n / 4));
  pushIdx(Math.floor((3 * n) / 4));
  pushIdx(0);
  pushIdx(n - 1);

  if (n > 20) {
    const step = Math.max(1, Math.floor(n / 8));
    for (let i = 0; i < n && idxs.length < 12; i += step) {
      pushIdx(i);
    }
  }

  const out: Point[] = [];
  const seen = new Set<string>();

  for (const i of idxs) {
    const p = points[i];
    const unit = pointToUnit(p, tileToLatLon, transformer);
    const projected = projectUnitWithVisibility(unit, transformer, proj);
    if (!projected.visible) continue;
    const x = Math.round(projected.x);
    const y = Math.round(projected.y);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y });
  }

  if (out.length === 0) {
    const step = Math.max(1, Math.floor(n / 32));
    for (let i = 0; i < n; i += step) {
      const p = points[i];
      const unit = pointToUnit(p, tileToLatLon, transformer);
      const projected = projectUnitWithVisibility(unit, transformer, proj);
      if (!projected.visible) continue;
      const x = Math.round(projected.x);
      const y = Math.round(projected.y);
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      out.push({ x, y });
      break;
    }
  }

  return out;
}

function isFeatureVisibleInGlobe(
  feature: TileFeature,
  tileToLatLon: (px: number, py: number) => LatLon,
  transformer: GlobeTransformer
): boolean {
  if (!Number.isFinite(feature.minX) || !Number.isFinite(feature.minY) ||
        !Number.isFinite(feature.maxX) || !Number.isFinite(feature.maxY)) {
    return true;
  }

  const corners = [
    { x: feature.minX, y: feature.minY },
    { x: feature.minX, y: feature.maxY },
    { x: feature.maxX, y: feature.minY },
    { x: feature.maxX, y: feature.maxY },
  ];

  for (const c of corners) {
    const unit = pointToUnit(c, tileToLatLon, transformer);
    const rotated = transformer.rotate(unit);
    if (rotated.z > -0.1) return true;
  }

  const centerPoint = {
    x: (feature.minX + feature.maxX) / 2,
    y: (feature.minY + feature.maxY) / 2,
  };
  const centerUnit = pointToUnit(centerPoint, tileToLatLon, transformer);
  return transformer.rotate(centerUnit).z > -0.1;
}

/**
 * Render a single feature onto the globe canvas
 */
function renderGlobeFeature(
  canvas: Canvas,
  transformer: GlobeTransformer,
  feature: TileFeature,
  tileX: number,
  tileY: number,
  tileZ: number,
  extent: number,
  debug?: GlobeDebugState,
  labelJobs?: GlobeLabelJob[]
): void {
  // IMPORTANT: color can legitimately be 0 (black). Only skip if it's actually missing.
  if (feature.color === undefined || feature.color === null) return;
  if (feature.style?.minzoom !== undefined && tileZ < feature.style.minzoom) return;
  if (feature.style?.maxzoom !== undefined && tileZ > feature.style.maxzoom) return;

  const tileToLatLon = (px: number, py: number): LatLon => {
    // Convert tile-local coordinates (in range 0 to extent) to lat/lon
    const fx = tileX + px / extent;
    const fy = tileY + py / extent;
    return tile2ll(fx, fy, tileZ);
  };

  // Get the points from the feature
  const points = feature.points;
  if (!points || !Array.isArray(points) || points.length === 0) return;

  const styleType = feature.style?.type;
  const geomType = feature.geomType;

  if (tileZ >= 8 && !isFeatureVisibleInGlobe(feature, tileToLatLon, transformer)) {
    return;
  }

  // Render based on STYLE first (geomType alone is ambiguous in this codebase)
  if (styleType === 'symbol') {
    if (config.noLabels || !labelJobs) return;
    const linePoints = points as Point[];
    if (!Array.isArray(linePoints) || linePoints.length === 0) return;
    const firstPoint = linePoints[0] as Point | undefined;
    if (!firstPoint || typeof firstPoint.x !== 'number' || typeof firstPoint.y !== 'number') {
      return;
    }
    const candidates = collectSymbolCandidates(linePoints, tileToLatLon, transformer, canvas.width, canvas.height);
    if (candidates.length === 0) return;
    const labelText = feature.label;
    const text = labelText || config.poiMarker;
    labelJobs.push({ feature, text, color: feature.color, candidates });
    return;
  } else if (styleType === 'fill' || (!styleType && geomType === 'Polygon')) {
    // Triangulate in tile space, then clip triangles to the visible hemisphere.
    const polygons = normalizePolygons(points);
    if (polygons.length === 0) return;

    const cached = (feature as { __triangles?: Point[][] }).__triangles;
    const triangles = cached ?? (() => {
      const out: Point[][] = [];
      for (const poly of polygons) {
        out.push(...triangulateRings(poly));
      }
      (feature as { __triangles?: Point[][] }).__triangles = out;
      return out;
    })();

    const proj = transformer.getProjection();
    for (const tri of triangles) {
      renderGlobeTriangle(canvas, transformer, proj, tri, tileToLatLon, feature.color, debug);
    }
    return;
  } else if (styleType === 'line' || (!styleType && geomType === 'LineString')) {
    // Line
    const linePoints = points as Point[];
    if (linePoints[0] && typeof (linePoints[0] as Point).x === 'number') {
      renderGlobeLine(canvas, transformer, linePoints, feature.color, tileToLatLon);
    } else {
      // Multi-line
      for (const line of points as Point[][]) {
        if (Array.isArray(line)) {
          renderGlobeLine(canvas, transformer, line, feature.color, tileToLatLon);
        }
      }
    }
  } else {
    // Points or unknown - just draw pixels
    const proj = transformer.getProjection();
    const firstElem = points[0];
    if (Array.isArray(firstElem)) {
      for (const ring of points as Point[][]) {
        if (!Array.isArray(ring)) continue;
        for (const p of ring) {
          if (p && typeof p.x === 'number') {
            const unit = pointToUnit(p, tileToLatLon, transformer);
            const projected = projectUnitWithVisibility(unit, transformer, proj);
            if (projected.visible) {
              canvas.setPixel(Math.round(projected.x), Math.round(projected.y), feature.color);
            }
          }
        }
      }
    } else if (firstElem && typeof (firstElem as Point).x === 'number') {
      for (const p of points as Point[]) {
        if (p && typeof p.x === 'number') {
          const unit = pointToUnit(p, tileToLatLon, transformer);
          const projected = projectUnitWithVisibility(unit, transformer, proj);
          if (projected.visible) {
            canvas.setPixel(Math.round(projected.x), Math.round(projected.y), feature.color);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Globe polygon helpers
// ---------------------------------------------------------------------------

interface RotatedPoint {
    x: number;
    y: number;
    z: number;
}

interface UnitPoint {
    x: number;
    y: number;
    z: number;
}

const HORIZON_EPS = 1e-6;

function isPoint(value: unknown): value is Point {
  return !!value && typeof (value as Point).x === 'number' && typeof (value as Point).y === 'number';
}

function normalizePolygons(points: unknown): Point[][][] {
  if (!Array.isArray(points) || points.length === 0) return [];

  const first = points[0];
  if (!Array.isArray(first) || first.length === 0) return [];

  if (isPoint(first[0])) {
    return [points as Point[][]];
  }

  if (Array.isArray(first[0]) && first[0].length > 0 && isPoint(first[0][0])) {
    return points as Point[][][];
  }

  return [];
}

function stripClosingPoint<T extends Point>(ring: T[]): T[] {
  if (!ring || ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a && b && a.x === b.x && a.y === b.y) return ring.slice(0, -1);
  return ring;
}

function signedArea2D(points: Point[]): number {
  let area = 0;
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }

  return area / 2;
}

function isPointInPolygon2D(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    if (((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

function findOverlappingHoles(outerRing: Point[], innerRings: Point[][], used: Set<number>): Point[][] {
  const overlapping: Point[][] = [];

  for (let i = 0; i < innerRings.length; i++) {
    if (used.has(i)) continue;
    const hole = innerRings[i];
    if (hole.length < 3) continue;
    if (isPointInPolygon2D(hole[0], outerRing)) {
      overlapping.push(hole);
      used.add(i);
    }
  }

  return overlapping;
}

function triangulateRings(rings: Point[][]): Point[][] {
  const outerRings: Point[][] = [];
  const innerRings: Point[][] = [];

  for (const ring of rings) {
    const baseRing = stripClosingPoint(ring);
    if (baseRing.length < 3) continue;
    const area = signedArea2D(baseRing);
    if (area < 0) {
      outerRings.push(baseRing);
    } else {
      innerRings.push(baseRing);
    }
  }

  const triangles: Point[][] = [];
  const usedHoles = new Set<number>();

  for (const outerRing of outerRings) {
    const vertices: number[] = [];
    const holes: number[] = [];

    for (const point of outerRing) {
      vertices.push(point.x, point.y);
    }

    const overlappingHoles = findOverlappingHoles(outerRing, innerRings, usedHoles);
    for (const hole of overlappingHoles) {
      holes.push(vertices.length / 2);
      for (const point of hole) {
        vertices.push(point.x, point.y);
      }
    }

    let indices: number[];
    try {
      indices = earcut(vertices, holes);
    } catch {
      continue;
    }

    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i] * 2;
      const ib = indices[i + 1] * 2;
      const ic = indices[i + 2] * 2;
      triangles.push([
        { x: vertices[ia], y: vertices[ia + 1] },
        { x: vertices[ib], y: vertices[ib + 1] },
        { x: vertices[ic], y: vertices[ic + 1] },
      ]);
    }
  }

  return triangles;
}

function isOnHorizon(p: RotatedPoint): boolean {
  return Math.abs(p.z) <= HORIZON_EPS;
}

function normalizeHorizonPoint(p: RotatedPoint): RotatedPoint {
  const len = Math.sqrt(p.x * p.x + p.y * p.y);
  if (len === 0) {
    return { x: 1, y: 0, z: 0 };
  }
  return { x: p.x / len, y: p.y / len, z: 0 };
}

function horizonArcStep(radius: number): number {
  const safeRadius = Math.max(1, radius);
  const targetPx = 4;
  const minStep = 0.01;
  const maxStep = 0.2;
  return Math.min(maxStep, Math.max(minStep, targetPx / safeRadius));
}

function arcPointsBetweenShortest(
  a: RotatedPoint,
  b: RotatedPoint,
  step: number
): RotatedPoint[] {
  const angleA = Math.atan2(a.y, a.x);
  const angleB = Math.atan2(b.y, b.x);
  let delta = angleB - angleA;

  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;

  const steps = Math.floor(Math.abs(delta) / step);
  if (steps <= 1) return [];

  const points: RotatedPoint[] = [];
  for (let i = 1; i < steps; i++) {
    const angle = angleA + (delta * i) / steps;
    points.push({ x: Math.cos(angle), y: Math.sin(angle), z: 0 });
  }
  return points;
}

function insertHorizonArcsShortest(points: RotatedPoint[], arcStep: number): RotatedPoint[] {
  if (points.length < 2) return points;

  const out: RotatedPoint[] = [];
  const n = points.length;

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push(a);
    if (isOnHorizon(a) && isOnHorizon(b)) {
      const arc = arcPointsBetweenShortest(a, b, arcStep);
      for (const p of arc) out.push(p);
    }
  }

  return out;
}

function clipRingToHorizon(points: RotatedPoint[]): RotatedPoint[] {
  if (points.length === 0) return [];

  const out: RotatedPoint[] = [];
  let prev = points[points.length - 1];
  let prevInside = prev.z >= -HORIZON_EPS;

  for (const curr of points) {
    const currInside = curr.z >= -HORIZON_EPS;
    if (currInside) {
      if (!prevInside) {
        out.push(intersectAtHorizon(prev, curr));
      }
      out.push(curr);
    } else if (prevInside) {
      out.push(intersectAtHorizon(prev, curr));
    }
    prev = curr;
    prevInside = currInside;
  }

  return out;
}

function intersectAtHorizon(a: RotatedPoint, b: RotatedPoint): RotatedPoint {
  const dz = b.z - a.z;
  if (dz === 0) {
    return normalizeHorizonPoint({ x: a.x, y: a.y, z: 0 });
  }

  let t = (0 - a.z) / dz;
  if (t < 0) t = 0;
  if (t > 1) t = 1;

  const point = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: 0,
  };
  return normalizeHorizonPoint(point);
}

function cleanRing2D(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
  }
  if (out.length >= 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first.x === last.x && first.y === last.y) out.pop();
  }
  return out;
}

function drawPolygonOutline(canvas: Canvas, points: Point[], color: number): void {
  if (points.length < 2) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    drawLineOnCanvas(canvas, a.x, a.y, b.x, b.y, color);
  }
}

function pointToUnit(
  p: Point,
  tileToLatLon: (px: number, py: number) => LatLon,
  transformer: GlobeTransformer
): UnitPoint {
  const cached = p as Point & { __unit?: UnitPoint };
  if (cached.__unit) return cached.__unit;
  const ll = tileToLatLon(p.x, p.y);
  const unit = transformer.latLonTo3D(ll.lat, ll.lon);
  cached.__unit = unit;
  return unit;
}

function projectUnitWithVisibility(
  unit: UnitPoint,
  transformer: GlobeTransformer,
  proj: GlobeProjection
): { x: number; y: number; visible: boolean; z: number } {
  const rotated = transformer.rotate(unit);
  const screenX = proj.width / 2 + rotated.x * proj.radius;
  const screenY = proj.height / 2 - rotated.y * proj.radius;
  return {
    x: screenX,
    y: screenY,
    visible: rotated.z > 0,
    z: rotated.z,
  };
}

function drawPolarCap(
  canvas: Canvas,
  transformer: GlobeTransformer,
  proj: GlobeProjection,
  latLimit: number,
  color: number
): void {
  const poleLat = latLimit > 0 ? 90 : -90;
  if (!transformer.project(poleLat, 0)) return;

  const segments = Math.max(24, Math.min(720, Math.round((2 * Math.PI * proj.radius) / 6)));
  const rotated: RotatedPoint[] = [];
  for (let i = 0; i < segments; i++) {
    const lon = -180 + (360 * i) / segments;
    const p3 = transformer.latLonTo3D(latLimit, lon);
    rotated.push(transformer.rotate(p3));
  }

  const clipped = clipRingToHorizon(rotated);
  if (clipped.length < 3) return;

  const arcStep = horizonArcStep(proj.radius);
  const withArcs = insertHorizonArcsShortest(clipped, arcStep);
  if (withArcs.length < 3) return;

  const screen = withArcs.map((p) => {
    const x = proj.width / 2 + p.x * proj.radius;
    const y = proj.height / 2 - p.y * proj.radius;
    return { x: Math.round(x), y: Math.round(y) };
  });

  // Skip entirely when the cap polygon can't touch the canvas (its interior
  // is contained in its bbox). When zoomed in away from the poles this
  // avoids fan-filling hundreds of giant off-screen triangles every frame.
  let minSX = Infinity, maxSX = -Infinity, minSY = Infinity, maxSY = -Infinity;
  for (const p of screen) {
    if (p.x < minSX) minSX = p.x;
    if (p.x > maxSX) maxSX = p.x;
    if (p.y < minSY) minSY = p.y;
    if (p.y > maxSY) maxSY = p.y;
  }
  if (maxSX < 0 || minSX > canvas.width - 1 || maxSY < 0 || minSY > canvas.height - 1) {
    return;
  }

  const cleaned = cleanRing2D(screen);
  if (cleaned.length < 3) return;

  for (let i = 1; i < cleaned.length - 1; i++) {
    canvas.fillTriangle(cleaned[0], cleaned[i], cleaned[i + 1], color);
  }
}

const TRI_SUBDIV_MAX_DEPTH = 5;
const TRI_SUBDIV_ERROR_PX = 0.75;
const TRI_SUBDIV_POLE_START = 70;
const TRI_SUBDIV_POLE_END = 90;
const TRI_SUBDIV_POLE_REDUCTION = 1;
const TRI_SUBDIV_POLE_EXTRA_DEPTH = 1;

function minTriangleEdgeDot(rotated: RotatedPoint[]): number {
  if (rotated.length !== 3) return 1;
  const dot01 = rotated[0].x * rotated[1].x + rotated[0].y * rotated[1].y + rotated[0].z * rotated[1].z;
  const dot12 = rotated[1].x * rotated[2].x + rotated[1].y * rotated[2].y + rotated[1].z * rotated[2].z;
  const dot20 = rotated[2].x * rotated[0].x + rotated[2].y * rotated[0].y + rotated[2].z * rotated[0].z;
  return Math.max(-1, Math.min(1, Math.min(dot01, dot12, dot20)));
}

function maxTriangleAngleForRadius(radius: number): number {
  const safeRadius = Math.max(1, radius);
  const ratio = Math.min(1, Math.max(0, TRI_SUBDIV_ERROR_PX / safeRadius));
  const half = Math.acos(Math.max(-1, 1 - ratio));
  return Math.max(0.01, Math.min(Math.PI, 2 * half));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function renderGlobeTriangleSubdiv(
  canvas: Canvas,
  transformer: GlobeTransformer,
  proj: GlobeProjection,
  tri: Point[],
  tileToLatLon: (px: number, py: number) => LatLon,
  color: number,
  depth: number,
  maxAngle: number,
  debug?: GlobeDebugState
): void {
  if (tri.length !== 3) return;

  const rotated: RotatedPoint[] = [];
  let maxAbsLat = 0;
  for (const p of tri) {
    const unit = pointToUnit(p, tileToLatLon, transformer);
    rotated.push(transformer.rotate(unit));
    const lat = Math.asin(unit.y) * 180 / Math.PI;
    maxAbsLat = Math.max(maxAbsLat, Math.abs(lat));
  }

  const minEdgeDot = minTriangleEdgeDot(rotated);
  const fullyVisible = rotated.every((p) => p.z > HORIZON_EPS);
  const poleT = Math.max(
    0,
    Math.min(1, (maxAbsLat - TRI_SUBDIV_POLE_START) / (TRI_SUBDIV_POLE_END - TRI_SUBDIV_POLE_START))
  );
  const localMaxAngle = maxAngle * (1 - TRI_SUBDIV_POLE_REDUCTION * poleT);
  const cosLocalMaxAngle = Math.cos(localMaxAngle);
  const localErrorPx = Math.max(
    0.2,
    TRI_SUBDIV_ERROR_PX * (1 - TRI_SUBDIV_POLE_REDUCTION * poleT)
  );
  const maxDepth = TRI_SUBDIV_MAX_DEPTH + (poleT > 0.5 ? TRI_SUBDIV_POLE_EXTRA_DEPTH : 0);

  let shouldSplit = false;
  if (depth < maxDepth) {
    if (minEdgeDot < cosLocalMaxAngle) {
      shouldSplit = true;
    } else if (poleT > 0 || !fullyVisible) {
      let maxErrorPx = 0;
      const screen = rotated.map((p) => ({
        x: proj.width / 2 + p.x * proj.radius,
        y: proj.height / 2 - p.y * proj.radius,
        visible: p.z >= -HORIZON_EPS,
      }));

      const projectTilePoint = (p: Point): RotatedPoint => {
        const unit = pointToUnit(p, tileToLatLon, transformer);
        return transformer.rotate(unit);
      };

      const addEdgeError = (ia: number, ib: number) => {
        const mid = midpoint(tri[ia], tri[ib]);
        const midRot = projectTilePoint(mid);
        const midScreen = {
          x: proj.width / 2 + midRot.x * proj.radius,
          y: proj.height / 2 - midRot.y * proj.radius,
          visible: midRot.z >= -HORIZON_EPS,
        };
        const a = screen[ia];
        const b = screen[ib];
        if (!a.visible || !b.visible || !midScreen.visible) return;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const err = Math.hypot(midScreen.x - mx, midScreen.y - my);
        if (err > maxErrorPx) maxErrorPx = err;
      };

      addEdgeError(0, 1);
      addEdgeError(1, 2);
      addEdgeError(2, 0);

      shouldSplit = maxErrorPx > localErrorPx;
    }
  }

  if (shouldSplit) {
    const a = tri[0];
    const b = tri[1];
    const c = tri[2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);

    renderGlobeTriangleSubdiv(
      canvas,
      transformer,
      proj,
      [a, ab, ca],
      tileToLatLon,
      color,
      depth + 1,
      maxAngle,
      debug
    );
    renderGlobeTriangleSubdiv(
      canvas,
      transformer,
      proj,
      [ab, b, bc],
      tileToLatLon,
      color,
      depth + 1,
      maxAngle,
      debug
    );
    renderGlobeTriangleSubdiv(
      canvas,
      transformer,
      proj,
      [ca, bc, c],
      tileToLatLon,
      color,
      depth + 1,
      maxAngle,
      debug
    );
    renderGlobeTriangleSubdiv(
      canvas,
      transformer,
      proj,
      [ab, bc, ca],
      tileToLatLon,
      color,
      depth + 1,
      maxAngle,
      debug
    );
    return;
  }

  if (fullyVisible) {
    const screen = rotated.map((p) => {
      const x = proj.width / 2 + p.x * proj.radius;
      const y = proj.height / 2 - p.y * proj.radius;
      return { x: Math.round(x), y: Math.round(y) };
    });

    // Viewport reject: when the triangle is flat enough (chord ≈ arc to
    // within ~1px, guaranteed by the subdivision criterion) and fully
    // outside the canvas, skip it. At high zoom most of the visible
    // hemisphere is off-screen, so this prunes the bulk of the work.
    const flatEnough = minEdgeDot >= cosLocalMaxAngle;
    if (flatEnough) {
      const margin = 4;
      if (
        (screen[0].x < -margin && screen[1].x < -margin && screen[2].x < -margin) ||
                (screen[0].x > proj.width - 1 + margin && screen[1].x > proj.width - 1 + margin && screen[2].x > proj.width - 1 + margin) ||
                (screen[0].y < -margin && screen[1].y < -margin && screen[2].y < -margin) ||
                (screen[0].y > proj.height - 1 + margin && screen[1].y > proj.height - 1 + margin && screen[2].y > proj.height - 1 + margin)
      ) {
        return;
      }
    }

    canvas.fillTriangle(screen[0], screen[1], screen[2], color);
    if (debug?.enabled && debug.triangles) {
      drawPolygonOutline(canvas, screen, DEBUG_TRIANGLE_COLOR);
    }
    return;
  }

  const clipped = clipRingToHorizon(rotated);
  if (clipped.length < 3) return;

  if (debug?.enabled && debug.horizon) {
    for (const p of clipped) {
      if (Math.abs(p.z) <= DEBUG_HORIZON_TOL) {
        const x = Math.round(proj.width / 2 + p.x * proj.radius);
        const y = Math.round(proj.height / 2 - p.y * proj.radius);
        if (x >= 0 && x < canvas.width && y >= 0 && y < canvas.height) {
          canvas.setPixel(x, y, DEBUG_HORIZON_COLOR);
        }
      }
    }
  }

  const arcStep = horizonArcStep(proj.radius);
  const withArcs = insertHorizonArcsShortest(clipped, arcStep);
  if (withArcs.length < 3) return;

  const screen = withArcs.map((p) => {
    const x = proj.width / 2 + p.x * proj.radius;
    const y = proj.height / 2 - p.y * proj.radius;
    return { x: Math.round(x), y: Math.round(y) };
  });

  const cleaned = cleanRing2D(screen);
  if (cleaned.length < 3) return;

  for (let i = 1; i < cleaned.length - 1; i++) {
    canvas.fillTriangle(cleaned[0], cleaned[i], cleaned[i + 1], color);
  }

  if (debug?.enabled && debug.triangles) {
    drawPolygonOutline(canvas, cleaned, DEBUG_TRIANGLE_COLOR);
  }
}

function renderGlobeTriangle(
  canvas: Canvas,
  transformer: GlobeTransformer,
  proj: GlobeProjection,
  tri: Point[],
  tileToLatLon: (px: number, py: number) => LatLon,
  color: number,
  debug?: GlobeDebugState
): void {
  if (tri.length !== 3) return;

  const maxAngle = maxTriangleAngleForRadius(proj.radius);
  renderGlobeTriangleSubdiv(
    canvas,
    transformer,
    proj,
    tri,
    tileToLatLon,
    color,
    0,
    maxAngle,
    debug
  );
}


/**
 * Render a polyline onto the globe
 */
function renderGlobeLine(
  canvas: Canvas,
  transformer: GlobeTransformer,
  points: Point[],
  color: number,
  tileToLatLon: (px: number, py: number) => LatLon
): void {
  if (points.length < 2) return;

  const proj = transformer.getProjection();
  // Convert and project each point; split runs at the horizon
  const screenPoints: Point[] = [];

  const flush = () => {
    if (screenPoints.length >= 2) {
      // Clip to the canvas: at high zoom, visible-hemisphere points can
      // be millions of pixels off-screen and Bresenham walks every pixel
      const parts = clipPolylineToRect(screenPoints, 0, 0, canvas.width - 1, canvas.height - 1);
      for (const part of parts) {
        canvas.polyline(part, color);
      }
    }
    screenPoints.length = 0;
  };

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const unit = pointToUnit(p, tileToLatLon, transformer);
    const projected = projectUnitWithVisibility(unit, transformer, proj);

    if (projected.visible) {
      screenPoints.push({ x: Math.round(projected.x), y: Math.round(projected.y) });
    } else {
      // Hit an invisible point: never connect across the horizon
      flush();
    }
  }

  flush();
}

/**
 * Draw the globe edge (outline of the sphere)
 */
function drawGlobeEdge(
  canvas: Canvas,
  width: number,
  height: number,
  radius: number,
  color: number
): void {
  const centerX = width / 2;
  const centerY = height / 2;

  // The globe is centered on screen: once the radius exceeds the half
  // diagonal, the edge circle lies entirely off-screen.
  if (radius > Math.hypot(width / 2, height / 2) + 1) return;

  // Sample densely enough that the circle stays continuous at any radius
  const steps = Math.max(90, Math.min(2048, Math.ceil((2 * Math.PI * radius) / 1.5)));
  for (let i = 0; i < steps; i++) {
    const rad = (2 * Math.PI * i) / steps;
    const x = Math.round(centerX + Math.cos(rad) * radius);
    const y = Math.round(centerY + Math.sin(rad) * radius);

    if (x >= 0 && x < width && y >= 0 && y < height) {
      canvas.setPixel(x, y, color);
    }
  }
}

function drawTileOutline(
  canvas: Canvas,
  transformer: GlobeTransformer,
  tileX: number,
  tileY: number,
  tileZ: number,
  color: number
): void {
  const steps = Math.max(12, Math.min(64, 8 + tileZ * 4));

  const drawEdge = (ax: number, ay: number, bx: number, by: number) => {
    let last: { x: number; y: number } | null = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const fx = ax + (bx - ax) * t;
      const fy = ay + (by - ay) * t;
      const ll = tile2ll(fx, fy, tileZ);
      const projected = transformer.project(ll.lat, ll.lon);
      if (projected) {
        const x = Math.round(projected.x);
        const y = Math.round(projected.y);
        if (last) {
          drawLineOnCanvas(canvas, last.x, last.y, x, y, color);
        }
        last = { x, y };
      } else {
        last = null;
      }
    }
  };

  drawEdge(tileX, tileY, tileX + 1, tileY);
  drawEdge(tileX + 1, tileY, tileX + 1, tileY + 1);
  drawEdge(tileX + 1, tileY + 1, tileX, tileY + 1);
  drawEdge(tileX, tileY + 1, tileX, tileY);
}

/**
 * Draw a line segment; Canvas clips it to the buffer before rasterizing.
 */
function drawLineOnCanvas(
  canvas: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: number
): void {
  canvas.line({ x: x0, y: y0 }, { x: x1, y: y1 }, color);
}
