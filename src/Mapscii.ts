/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  UI and central command center
*/

import fs from 'fs';
import path from 'path';
import stringWidth from 'string-width';
import Renderer, { Marker, HoverItem } from './Renderer';
import { MarkerInput } from './Markers';
import TileSource, { type TileCacheResetResult } from './TileSource';
import * as utils from './utils';
import config, { type ColorMode, type TerrainConfig } from './config';
import InputHandler, { InputEvent, term } from './InputHandler';
import Canvas from './Canvas';
import { getCurrentLocation } from './Geolocation';
import { showHelpModal } from './HelpModal';
import { showSearchPrompt, geocodeQuery } from './SearchBox';
import { showGlobeView } from './Globe';

// Mouse event types
interface MouseEvent {
  x: number;
  y: number;
  button: 'left' | 'middle' | 'right' | 'up' | 'down' | 'none';
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  action?: 'press' | 'release' | 'move' | 'scroll' | 'drag';
}

interface DragState {
  x: number;
  y: number;
  center: utils.TileCoord;
}

export interface MapsciiOptions {
  initialLat?: number;
  initialLon?: number;
  initialZoom?: number | null;
  size?: { width?: number; height?: number };
  useBraille?: boolean;
  headless?: boolean;
  source?: string;
  styleFile?: string;
  markerInputs?: MarkerInput[];
  cellGeometry?: { width: number; height: number };
  noLabels?: boolean;
  colorMode?: ColorMode;
  useTileWorker?: boolean;
  showAttribution?: boolean;
  attribution?: string;
  ansiScreenshotFile?: string | null;
  exitAfterAnsiScreenshot?: boolean;
  terrain?: TerrainConfig;
  /** If true, show current location marker and zoom to it (like pressing 'G') */
  locateOnStart?: boolean;
  /** Source description for location (e.g., 'IP (Paris, FR)') */
  locationSource?: string;
}

export interface MapsciiState {
  center: utils.LatLon;
  zoom: number;
  markers: Marker[];
}

export interface MapsciiPointerEvent {
  x: number;
  y: number;
  lat: number;
  lon: number;
  features: HoverItem[];
}

export interface MapsciiEventMap {
  ready: MapsciiState;
  update: MapsciiState;
  move: MapsciiState;
  zoom: MapsciiState;
  click: MapsciiPointerEvent;
  hover: MapsciiPointerEvent;
  'marker:add': Marker;
  'marker:remove': { id: string };
  'markers:clear': undefined;
  quit: MapsciiState;
  error: Error;
}

type MapsciiEventHandler<K extends keyof MapsciiEventMap> = (payload: MapsciiEventMap[K]) => void;

export default class Mapscii {
  private width: number = 0;
  private height: number = 0;
  private canvas: Canvas | null = null;
  private mouseDragging: DragState | false = false;
  private mousePosition: utils.LatLon = { lat: 0, lon: 0 };
  private tileSource: TileSource | null = null;
  private renderer: Renderer | null = null;
  private zoom: number = 0;
  private minZoom: number = 0;
  private maxZoom: number = 18;
  private center: utils.LatLon;
  private inputHandler: InputHandler | null = null;
  private markerInputs: MarkerInput[] = [];
  private isInPrompt: boolean = false;  // Flag to prevent key handling during prompts
  private locateOnStart: boolean = false;
  private locationSource: string = '';
  private isDrawing: boolean = false;
  private redrawPending: boolean = false;
  private currentDrawPromise: Promise<void> | null = null;
  private initialAnsiScreenshotSaved: boolean = false;
  private hoverItems: HoverItem[] = [];
  private listeners: Partial<Record<keyof MapsciiEventMap, Set<(payload: unknown) => void>>> = {};

  constructor(options: MapsciiOptions = {}) {
    Object.assign(config, options);

    this.center = {
      lat: config.initialLat,
      lon: config.initialLon
    };

    // Store marker inputs from options (will be added to renderer after init)
    if (options.markerInputs) {
      this.markerInputs = options.markerInputs;
    }

    // Store locate-on-start settings
    this.locateOnStart = options.locateOnStart ?? false;
    this.locationSource = options.locationSource ?? '';
  }

  async init(): Promise<void> {
    if (!config.headless) {
      this._initInput();
    }
    await this._initTileSource();
    this._initRenderer();

    // Handle --locate startup: add marker and zoom like pressing 'G'
    if (this.locateOnStart) {
      this._setLocationAndDraw(this.center.lat, this.center.lon, this.locationSource);
    } else {
      await this._draw();
      this.notify('Welcome to MapSCII! Use your cursors to navigate, a/z to zoom, q to quit.');
    }
    this.emit('ready', this.getState());
  }

  // Public API for programmatic use (Issue #35, #97)
  on<K extends keyof MapsciiEventMap>(event: K, handler: MapsciiEventHandler<K>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = new Set();
    }
    this.listeners[event]?.add(handler as (payload: unknown) => void);
    return () => this.off(event, handler);
  }

  off<K extends keyof MapsciiEventMap>(event: K, handler: MapsciiEventHandler<K>): void {
    this.listeners[event]?.delete(handler as (payload: unknown) => void);
  }

  getState(): MapsciiState {
    return {
      center: { ...this.center },
      zoom: this.zoom,
      markers: this.getMarkers(),
    };
  }

  getCenter(): utils.LatLon {
    return { ...this.center };
  }

  getZoom(): number {
    return this.zoom;
  }

  featuresAt(x: number, y: number): HoverItem[] {
    return this.renderer?.featuresAt(x, y) ?? [];
  }

  setCenter(lat: number, lon: number): void {
    this.center = utils.normalize({ lat, lon });
    this.emit('move', this.getState());
    this._draw();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    this.emit('zoom', this.getState());
    this._draw();
  }

  addMarker(input: MarkerInput): Marker | null {
    const marker = this.renderer?.markerStore.upsertMarker(input) ?? null;
    if (marker) this.emit('marker:add', marker);
    this._draw();
    return marker;
  }

  removeMarker(id: string): boolean {
    const removed = this.renderer?.markerStore.removeMarker(id) ?? false;
    if (removed) this.emit('marker:remove', { id });
    this._draw();
    return removed;
  }

  clearMarkers(): void {
    this.renderer?.clearMarkers();
    this.emit('markers:clear', undefined);
    this._draw();
  }

  async resetTileCache(): Promise<TileCacheResetResult | null> {
    const result = this.tileSource?.resetCache() ?? null;
    this._write('\x1B[2J');
    this._draw();
    return result;
  }

  exportAnsiScreenshot(filePath?: string): string {
    if (!this.renderer) {
      throw new Error('Renderer is not initialized');
    }

    const outputPath = path.resolve(filePath || this._defaultAnsiScreenshotPath());
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, this.renderer.getAnsiScreenshot(), 'utf8');
    return outputPath;
  }

  getMarkers(): Marker[] {
    return this.renderer?.getMarkers() ?? [];
  }

  private async _initTileSource(): Promise<void> {
    this.tileSource = new TileSource();
    await this.tileSource.init(config.source);
    this.maxZoom = this.tileSource.getMaxZoom();

    // A standalone .pbf/.mvt only provides the 0/0/0 tile: pin the base tile
    // zoom to 0 so every zoom level overzooms (scales) that single tile
    // instead of requesting tiles that don't exist.
    if (this.tileSource.isSingleVectorTile()) {
      config.tileRange = 0;
    }
  }

  private _initInput(): void {
    this.inputHandler = new InputHandler(config.input as NodeJS.ReadStream, config.output);

    this.inputHandler.start((event: InputEvent) => {
      switch (event.type) {
        case 'key':
          this._onKey({ name: event.key || '' });
          break;
        case 'mouse':
          this._handleMouseEvent({
            x: event.x || 0,
            y: event.y || 0,
            button: event.button || 'none',
            action: event.action as MouseEvent['action']
          });
          break;
        case 'scroll':
          this._handleMouseEvent({
            x: event.x || 0,
            y: event.y || 0,
            button: (event.delta || 0) > 0 ? 'up' : 'down',
            action: 'scroll'
          });
          break;
      }
    });

    // Cleanup on exit
    process.on('exit', () => {
      this.inputHandler?.stop();
    });

    process.on('SIGINT', () => {
      this.inputHandler?.stop();
      process.exit(0);
    });
  }

  private _handleMouseEvent(event: MouseEvent): void {
    // Ignore mouse events during prompts
    if (this.isInPrompt) return;

    switch (event.action) {
      case 'press':
        if (event.button === 'left') {
          this._onMouseDown(event);
        }
        break;
      case 'release':
        if (event.button === 'left' || event.button === 'none') {
          this._onClick(event);
        }
        break;
      case 'move':
        this._onMouseMove(event);
        break;
      case 'drag':
        // Handle drag from InputHandler (button is 'left' during drag)
        event.button = 'left';
        this._onMouseMove(event);
        break;
      case 'scroll':
        this._onMouseScroll(event);
        break;
    }
  }

  private _initRenderer(): void {
    const style = JSON.parse(fs.readFileSync(config.styleFile, 'utf8'));
    this.renderer = new Renderer(config.output, this.tileSource!, style);

    // Add initial markers if any
    if (this.markerInputs.length > 0) {
      for (const input of this.markerInputs) {
        this.renderer.markerStore.upsertMarker(input);
      }
    }

    config.output.on('resize', () => {
      // Always resize the renderer to match new terminal size
      this._resizeRenderer();

      // Only redraw if not in a prompt (search, help, globe handle their own display)
      if (!this.isInPrompt) {
        // Clear screen to prevent visual artifacts during resize
        this._write('\x1B[2J');
        this._draw();
      }
    });

    this._resizeRenderer();
    this.zoom = (config.initialZoom !== null) ? config.initialZoom : this.minZoom;
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom));
  }

  private _resizeRenderer(): void {
    // Canvas always uses 2x4 internal pixels per character cell (braille standard)
    // The cellGeometry config is used only for map projection aspect ratio correction
    this.width = config.size?.width ? config.size.width * 2 : config.output.columns >> 1 << 2;
    this.height = config.size?.height ? config.size.height * 4 : config.output.rows * 4 - 4;

    this.minZoom = this.tileSource?.isSingleVectorTile()
      ? 0
      : 4 - Math.log(4096 / this.width) / Math.LN2;

    // Enforce zoom limits after resize - if window got bigger, minZoom decreases
    // and current zoom might now be below the new minimum
    if (this.zoom < this.minZoom) {
      this.zoom = this.minZoom;
    }
    if (this.zoom > this.maxZoom) {
      this.zoom = this.maxZoom;
    }

    this.renderer?.setSize(this.width, this.height);
  }

  private _colrow2ll(x: number, y: number): utils.LatLon {
    // Convert screen column/row to lat/lon
    // Screen coordinates are in character cells, internal uses 2x4 pixels
    const projected = {
      x: (x - 0.5) * 2,
      y: (y - 0.5) * 4,
    };

    const size = utils.tilesizeAtZoom(this.zoom);
    const dx = projected.x - this.width / 2;
    const dy = projected.y - this.height / 2;

    // Apply aspect correction for Y (inverse of render correction)
    const cellWidth = config.cellGeometry?.width || 2;
    const cellHeight = config.cellGeometry?.height || 4;
    const standardRatio = 4 / 2;
    const actualRatio = cellHeight / cellWidth;
    const aspectY = standardRatio / actualRatio;

    const z = utils.baseZoom(this.zoom);
    const center = utils.ll2tile(this.center.lon, this.center.lat, z);

    return utils.normalize(utils.tile2ll(center.x + (dx / size), center.y + (dy / size / aspectY), z));
  }

  private _updateMousePosition(event: MouseEvent): void {
    this.mousePosition = this._colrow2ll(event.x, event.y);
  }

  private _onMouseDown(event: MouseEvent): void {
    if (event.x < 0 || event.x > this.width / 2 || event.y < 0 || event.y > this.height / 4) {
      return;
    }

    // Start potential drag
    this.mouseDragging = {
      x: event.x,
      y: event.y,
      center: utils.ll2tile(this.center.lon, this.center.lat, utils.baseZoom(this.zoom)),
    };
  }

  private _onClick(event: MouseEvent): void {
    if (event.x < 0 || event.x > this.width / 2 || event.y < 0 || event.y > this.height / 4) {
      return;
    }
    this._updateMousePosition(event);

    if (this.mouseDragging) {
      // Check if this was a drag or a click
      const dragDist = Math.abs(this.mouseDragging.x - event.x) + Math.abs(this.mouseDragging.y - event.y);
      if (dragDist > 2) {
        // This was a drag, don't center on click
        this.mouseDragging = false;
        return;
      }
      this.mouseDragging = false;
    }

    // Center on clicked position
    const features = this.renderer?.featuresAt(event.x, event.y) ?? [];
    this.emit('click', {
      x: event.x,
      y: event.y,
      lat: this.mousePosition.lat,
      lon: this.mousePosition.lon,
      features,
    });
    this.setCenter(this.mousePosition.lat, this.mousePosition.lon);
    this._draw();
  }

  private _onMouseScroll(event: MouseEvent): void {
    this._updateMousePosition(event);

    // the location of the pointer, where we want to zoom toward
    const targetMouseLonLat = this._colrow2ll(event.x, event.y);

    // zoom toward the center
    this.zoomBy(config.zoomStep * (event.button === 'up' ? 1 : -1));

    // the location the pointer ended up after zooming
    const offsetMouseLonLat = this._colrow2ll(event.x, event.y);

    const z = utils.baseZoom(this.zoom);
    // the projected locations
    const targetMouseTile = utils.ll2tile(targetMouseLonLat.lon, targetMouseLonLat.lat, z);
    const offsetMouseTile = utils.ll2tile(offsetMouseLonLat.lon, offsetMouseLonLat.lat, z);

    // the projected center
    const centerTile = utils.ll2tile(this.center.lon, this.center.lat, z);

    // calculate a new center that puts the pointer back in the target location
    const offsetCenterLonLat = utils.tile2ll(
      centerTile.x - (offsetMouseTile.x - targetMouseTile.x),
      centerTile.y - (offsetMouseTile.y - targetMouseTile.y),
      z
    );
    // move to the new center
    this.setCenter(offsetCenterLonLat.lat, offsetCenterLonLat.lon);

    // Reset drag reference if we're in the middle of a drag, since zoom changed the coordinate system
    if (this.mouseDragging) {
      this.mouseDragging = {
        x: event.x,
        y: event.y,
        center: utils.ll2tile(this.center.lon, this.center.lat, utils.baseZoom(this.zoom)),
      };
    }

    this._draw();
  }

  private _onMouseMove(event: MouseEvent): void {
    if (event.x < 0 || event.x > this.width / 2 || event.y < 0 || event.y > this.height / 4) {
      return;
    }
    if (config.mouseCallback && !config.mouseCallback(event)) {
      return;
    }

    // Handle dragging - apply inverse aspect correction for proper map movement
    if (this.mouseDragging && event.button === 'left') {
      const cellWidth = config.cellGeometry?.width || 2;
      const cellHeight = config.cellGeometry?.height || 4;
      const standardRatio = 4 / 2;
      const actualRatio = cellHeight / cellWidth;
      const aspectY = standardRatio / actualRatio;

      const dx = (this.mouseDragging.x - event.x) * 2;
      const dy = (this.mouseDragging.y - event.y) * 4 / aspectY;

      const size = utils.tilesizeAtZoom(this.zoom);

      const newCenter = utils.tile2ll(
        this.mouseDragging.center.x + (dx / size),
        this.mouseDragging.center.y + (dy / size),
        utils.baseZoom(this.zoom)
      );

      this.setCenter(newCenter.lat, newCenter.lon);
      this._draw();
    }

    this._updateMousePosition(event);
    this.hoverItems = this.renderer?.featuresAt(event.x, event.y) ?? [];
    this.emit('hover', {
      x: event.x,
      y: event.y,
      lat: this.mousePosition.lat,
      lon: this.mousePosition.lon,
      features: this.hoverItems,
    });
    this.notify(this._getFooter());
  }

  private _onKey(key: { name: string }): void {
    // Ignore keys when in a prompt (search, help, etc.)
    if (this.isInPrompt) return;

    if (config.keyCallback && !config.keyCallback(key)) return;
    if (!key || !key.name) return;

    // Try the exact key first (uppercase bindings like S/R), then fall back
    // to the lowercase binding so e.g. 'A' still zooms like 'a'.
    if (this._handleKeyName(key.name)) return;
    const lower = key.name.toLowerCase();
    if (lower !== key.name) {
      this._handleKeyName(lower);
    }
  }

  private _handleKeyName(name: string): boolean {
    let handled = true;
    let draw = true;
    switch (name) {
      case 'q':
        this.inputHandler?.stop();
        this.emit('quit', this.getState());
        if (config.quitCallback) {
          config.quitCallback();
        } else {
          process.exit(0);
        }
        break;
      case 'a':
        this.zoomBy(config.zoomStep);
        break;
      case 'y':
      case 'z':
        this.zoomBy(-config.zoomStep);
        break;
      case 'left':
      case 'h':
        this.moveBy(0, -8 / Math.pow(2, this.zoom));
        break;
      case 'right':
      case 'l':
        this.moveBy(0, 8 / Math.pow(2, this.zoom));
        break;
      case 'up':
      case 'k':
        this.moveBy(6 / Math.pow(2, this.zoom), 0);
        break;
      case 'down':
      case 'j':
        this.moveBy(-6 / Math.pow(2, this.zoom), 0);
        break;
      case 'c':
        config.useBraille = !config.useBraille;
        break;
      case 't':
        // Toggle text labels and POI markers (minimal mode)
        config.noLabels = !config.noLabels;
        this.notify(config.noLabels ? 'Minimal mode (no text)' : 'Labels enabled');
        break;
      case 'm':
        // Clear all markers
        this.clearMarkers();
        this.notify('Markers cleared');
        break;
      case 'S':
        // Export current canvas as an ANSI terminal screenshot
        this._handleExportAnsiScreenshot();
        draw = false;
        break;
      case 'R':
        // Reset tile caches when persisted data got corrupted
        void this._handleResetTileCache();
        draw = false;
        break;
      case '/':
      case 's':
        // Search / goto prompt (Issue #27, #105)
        // Use void to handle async without blocking
        void this._handleSearch();
        draw = false;
        break;
      case 'g':
        // Go to current location via IP geolocation (Issue #2, #12)
        void this._gotoCurrentLocation();
        draw = false;
        break;
      case '?':
        // Show help
        void this._handleHelp();
        draw = false;
        break;
      case 'o':
        // Toggle 3D globe view
        void this._handleGlobeView();
        draw = false;
        break;
      default:
        handled = false;
        draw = false;
    }

    if (draw) {
      this._draw();
    }
    return handled;
  }

  private _draw(): Promise<void> {
    // Coalesce: keep at most one frame in flight and one pending, so rapid
    // input (drag/scroll) always ends with a frame of the latest state
    // instead of dropping it with "renderer is busy".
    if (this.isDrawing) {
      this.redrawPending = true;
      return this.currentDrawPromise ?? Promise.resolve();
    }
    const renderer = this.renderer;
    if (!renderer) return Promise.resolve();
    this.isDrawing = true;
    this.currentDrawPromise = renderer.draw(this.center, this.zoom).then((frame) => {
      this._write(frame);
      this._saveInitialAnsiScreenshotIfRequested();
      this.notify(this._getFooter());
      this.emit('update', this.getState());
    }).catch((error: Error) => {
      this.emit('error', error);
      this.notify(error?.message === 'Already drawing'
        ? 'renderer is busy'
        : `Render failed: ${error?.message || error}`);
    }).finally(() => {
      this.isDrawing = false;
      // Clear the promise reference BEFORE kicking off the pending redraw,
      // otherwise we'd null out the new frame's promise.
      this.currentDrawPromise = null;
      if (this.redrawPending) {
        this.redrawPending = false;
        this._draw();
      }
    });

    return this.currentDrawPromise;
  }

  private _getFooter(): string {
    let footer = `center: ${utils.digits(this.center.lat, 3)}, ${utils.digits(this.center.lon, 3)} `;
    footer += `  zoom: ${utils.digits(this.zoom, 2)} `;
    if (this.mousePosition.lat !== undefined) {
      footer += `  mouse: ${utils.digits(this.mousePosition.lat, 3)}, ${utils.digits(this.mousePosition.lon, 3)} `;
    }
    if (this.hoverItems.length) {
      footer += `  hover: ${this._describeHoverItem(this.hoverItems[0])} `;
    }
    return footer;
  }

  private _describeHoverItem(item: HoverItem): string {
    const feature = item.feature;
    const layer = 'layer' in item ? item.layer : feature?.layer;
    const text = this._singleLineStatusText(item.text || feature?.label || layer || '');
    if (!feature) return text || 'marker';
    return text ? `${feature.layer}:${text}` : feature.layer;
  }

  notify(text: string): void {
    config.onUpdate?.();
    if (!config.headless) {
      const maxRow = config.output.rows || Math.floor(this.height / 4) + 1;
      const row = Math.min(maxRow, Math.max(1, Math.floor(this.height / 4) + 1));
      this._write(`\x1B[${row};1H\x1B[2K${this._fitStatusText(text)}`);
    }
  }

  private _fitStatusText(text: string): string {
    text = this._singleLineStatusText(text);
    const maxWidth = Math.max(1, (config.output.columns || Math.floor(this.width / 2) || 80) - 1);

    if (stringWidth(text) <= maxWidth) return text;
    if (maxWidth <= 3) return text.slice(0, maxWidth);

    // Accumulate per-character widths instead of re-measuring the whole
    // prefix each step (O(n) instead of O(n²)).
    let output = '';
    let width = 0;
    const budget = maxWidth - 3; // room for the ellipsis
    for (const char of text) {
      const charWidth = stringWidth(char);
      if (width + charWidth > budget) break;
      output += char;
      width += charWidth;
    }
    return output + '...';
  }

  private _singleLineStatusText(text: string): string {
    return String(text)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trimEnd();
  }

  private _defaultAnsiScreenshotPath(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `mapscii-${timestamp}.ans`;
  }

  private _handleExportAnsiScreenshot(): void {
    try {
      const savedPath = this.exportAnsiScreenshot();
      this.notify(`ANSI screenshot saved: ${savedPath}`);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      this.notify(`ANSI screenshot failed: ${err.message}`);
    }
  }

  private _saveInitialAnsiScreenshotIfRequested(): void {
    if (!config.ansiScreenshotFile || this.initialAnsiScreenshotSaved) return;

    const savedPath = this.exportAnsiScreenshot(config.ansiScreenshotFile);
    this.initialAnsiScreenshotSaved = true;

    if (config.exitAfterAnsiScreenshot) {
      if (!config.headless) {
        this.notify(`ANSI screenshot saved: ${savedPath}`);
      }
      this.inputHandler?.stop();
      process.exit(0);
    }
  }

  // Handle search using SearchBox module
  private async _handleSearch(): Promise<void> {
    this.isInPrompt = true;

    const result = await showSearchPrompt();

    this.isInPrompt = false;

    if (result.type === 'cancelled' || result.type === 'empty') {
      this._draw();
      return;
    }

    if (result.type === 'coordinates' && result.lat !== undefined && result.lon !== undefined) {
      // Add marker for coordinates
      this.renderer?.markerStore.upsertMarker({
        id: `search-${Date.now()}`,
        lat: result.lat,
        lon: result.lon,
        glyph: '⚲',
        color: '#ff6600',
      });

      this.center = utils.normalize({ lat: result.lat, lon: result.lon });
      if (this.zoom < 12) this.zoom = 12;
      this._draw();
      this.notify(`[⚲] ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`);
      return;
    }

    if (result.type === 'geohash' && result.lat !== undefined && result.lon !== undefined) {
      // Add marker for geohash location
      this.renderer?.markerStore.upsertMarker({
        id: `search-${Date.now()}`,
        lat: result.lat,
        lon: result.lon,
        glyph: '#',
        color: '#9933ff',
        label: ` ${result.query}`,
      });

      this.center = utils.normalize({ lat: result.lat, lon: result.lon });
      // Geohash zoom based on precision (longer = more precise = higher zoom)
      const geohashLen = result.query?.length || 6;
      const targetZoom = Math.min(18, 4 + geohashLen * 1.5);
      if (this.zoom < targetZoom) this.zoom = targetZoom;
      this._draw();
      this.notify(`[#] Geohash: ${result.query} → ${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}`);
      return;
    }

    if (result.type === 'place') {
      if (result.lat !== undefined && result.lon !== undefined) {
        // Already have coordinates from dropdown selection
        this.renderer?.markerStore.upsertMarker({
          id: `search-${Date.now()}`,
          lat: result.lat,
          lon: result.lon,
          glyph: '⚲',
          color: '#ff6600',
          label: ' ' + result.displayName?.split(',')[0],
        });

        this.center = utils.normalize({ lat: result.lat, lon: result.lon });
        if (this.zoom < 12) this.zoom = 12;
        this._draw();
        this.notify(`[⚲] ${result.displayName?.slice(0, 60) || 'Found'}`);
      } else if (result.query) {
        // Need to geocode the query
        this.notify(`Searching: ${result.query}...`);
        const geocoded = await geocodeQuery(result.query);

        if (geocoded) {
          const lat = parseFloat(geocoded.lat);
          const lon = parseFloat(geocoded.lon);

          this.renderer?.markerStore.upsertMarker({
            id: `search-${Date.now()}`,
            lat,
            lon,
            glyph: '⚲',
            color: '#ff6600',
            label: ' ' + geocoded.display_name.split(',')[0],
          });

          this.center = utils.normalize({ lat, lon });
          if (this.zoom < 12) this.zoom = 12;
          this._draw();
          this.notify(`[⚲] ${geocoded.display_name.slice(0, 60)}`);
        } else {
          this.notify(`No results for: ${result.query}`);
          this._draw();
        }
      }
    }
  }

  // Handle help using HelpModal module
  private async _handleHelp(): Promise<void> {
    this.isInPrompt = true;

    await showHelpModal({
      center: this.center,
      zoom: this.zoom,
      width: this.width,
      height: this.height,
    });

    this.isInPrompt = false;
    this._draw();
  }

  // Handle 3D globe view
  private async _handleGlobeView(): Promise<void> {
    this.isInPrompt = true;

    // Collect markers from renderer
    const markers = this.renderer?.getMarkers().map(m => ({
      lat: m.lat,
      lon: m.lon,
      glyph: m.glyph || '●',
      color: m.color,
      label: m.label,
    })) || [];

    // Get the style from the renderer
    const style = JSON.parse(fs.readFileSync(config.styleFile, 'utf8'));

    await showGlobeView({
      centerLat: this.center.lat,
      centerLon: this.center.lon,
      zoom: this.zoom,
      markers,
      tileSource: this.tileSource!,
      style,
    });

    this.isInPrompt = false;
    // Clear and redraw after exiting globe view
    this._write('\x1B[2J');
    this._draw();
  }

  // Go to current location - uses @derhuerst/location with IP fallback
  private async _gotoCurrentLocation(): Promise<void> {
    this.notify('Getting location...');

    try {
      const location = await getCurrentLocation();
      this._setLocationAndDraw(location.latitude, location.longitude, location.source);
    } catch {
      this.notify('Location lookup failed');
      this._draw();
    }
  }

  // Helper to set location and update display
  private _setLocationAndDraw(lat: number, lon: number, source: string): void {
    // Add location marker (use 'O' as glyph for "you are here")
    this.renderer?.markerStore.upsertMarker({
      id: 'current-location',
      lat,
      lon,
      glyph: '⚲',
      color: '#00ff00',
      label: ' You',
    });

    this.center = utils.normalize({ lat, lon });
    if (this.zoom < 12) {
      this.zoom = 12;
    }
    this._draw();
    this.notify(`[⚲] ${source} (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
  }

  private _write(output: string): void {
    // Use terminal-kit's noFormat when InputHandler is active to avoid interference
    if (this.inputHandler) {
      term.noFormat(output);
    } else {
      config.output.write(output);
    }
  }

  zoomBy(step: number): number {
    if (this.zoom + step < this.minZoom) {
      return this.zoom = this.minZoom;
    }
    if (this.zoom + step > this.maxZoom) {
      return this.zoom = this.maxZoom;
    }

    return this.zoom += step;
  }

  moveBy(lat: number, lon: number): void {
    this.setCenter(this.center.lat + lat, this.center.lon + lon);
  }

  private async _handleResetTileCache(): Promise<void> {
    try {
      const result = await this.resetTileCache();
      const persistent = result?.persistentPaths.length ?? 0;
      this.notify(`Tile cache reset (${persistent} persistent ${persistent === 1 ? 'path' : 'paths'} cleared)`);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      this.notify(`Tile cache reset failed: ${err.message}`);
    }
  }

  private emit<K extends keyof MapsciiEventMap>(event: K, payload: MapsciiEventMap[K]): void {
    this.listeners[event]?.forEach((handler) => handler(payload));
  }
}
