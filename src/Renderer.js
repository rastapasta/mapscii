/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
*/
'use strict';
const x256 = require('x256');
const stringWidth = require('string-width');
const simplify = require('simplify-js');

const Canvas = require('./Canvas');
const LabelBuffer = require('./LabelBuffer');
const Styler = require('./Styler');
const utils = require('./utils');
const config = require('./config');

// order in which names get a place on the map, most important first
const labelPriority = [
  'country_label',
  'state_label',
  'marine_label',
  'place_label',
  'water_label',
  'airport_label',
  'rail_station_label',
  'poi_label',
  'road_label',
  'housenum_label',
];

class Renderer {
  constructor(output, tileSource, style) {
    this.output = output;
    this.tileSource = tileSource;
    this.labelBuffer = new LabelBuffer();
    this.expandedLabel = null;
    this.overlays = [];
    this.view = 'map';
    this.rasters = {};
    this.shortenedLabels = [];
    this.styler = new Styler(style);
    this.tileSource.useStyler(this.styler);
  }

  // Sets the size of the map in pixels
  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = new Canvas(width, height);
    this.previousLines = null;
  }

  // Draws a frame: the view's picture, the tiles, overlays and markers
  async draw(center, zoom, markers = []) {
    if (this.isDrawing) return Promise.reject();
    this.isDrawing = true;

    this.labelBuffer.clear();
    this._seen = {};
    this._shortened = [];

    let ref;
    const color = ((ref = this.styler.styleById['background']) !== null ?
      ref.paint['background-color']
      :
      void 0
    );
    if (color) {
      this.canvas.setBackground(x256(utils.hex2rgb(color)));
    }

    this.canvas.clear();
    // queued pictures this frame doesn't ask for are dropped (see RasterSource)
    for (const source of Object.values(this.rasters || {})) if (source && source.beginFrame) source.beginFrame();

    try {
      if (this.view === '3d' && this.rasters.terrain) {
        require('./Terrain3D').render(this.canvas.buffer, {
          center, zoom, heading: this.heading || 0, terrain: this.rasters.terrain, tint,
          columns: this.width >> 1, rows: this.height >> 2,
          // terrainDetail is -2 at normal picture detail
          detail: config.terrainDetail + 2,
          imagery: this.photo3d ? this.rasters.imagery || null : null,
        });
        this.missingTiles = 0;
        this.failedCount = 0;
        this.shortenedLabels = [];
        this.lastFrame = {filled: 1, names: 99};
        return this._getFrame();
      }
      // only tiles in memory are drawn; missing ones load in the background, with stand-ins meanwhile
      this.tileSource.beginFrame();
      this._trackMovement(center, zoom);
      const tiles = this._resolveTiles(this._visibleTiles(center, zoom));
      if (this.missingTiles === 0 && config.prefetch) {
        this._prefetchAround(center, zoom);
      }
      for (const tile of tiles) {
        this._getTileFeatures(tile, zoom);
      }
      // markers are placed before labels so no name covers them
      const markerPositions = this._markerPositions(center, zoom, markers);
      for (const position of markerPositions) {
        // a margin of 1 keeps its row clear but lets names sit right above or below it
        this.labelBuffer.writeIfPossible(config.locationMarker, position.x, position.y, null, 1);
      }
      const overlayPoints = this._placeOverlayPoints(center, zoom);
      // skipPictures: drawn elsewhere, e.g. finer by the phone app
      if ((this.view === 'satellite' || this.view === 'hybrid' || this.view === 'relief') && !this.skipPictures) {
        this._drawRaster(center, zoom);
      }
      this._renderTiles(tiles, zoom);
      this._drawOverlayLines(center, zoom);
      for (const {text, x, y, color} of overlayPoints) {
        this.canvas.text(text, x, y, color);
      }
      for (const position of markerPositions) {
        this.canvas.text(config.locationMarker, position.x, position.y, config.locationMarkerColor);
      }
      this.shortenedLabels = this._shortened;
      this.lastFrame = {filled: this.canvas.buffer.filledShare(), names: Object.keys(this._seen).length};
      return this._getFrame();
    } catch(e) {
      console.error(e);
    } finally {
      this.isDrawing = false;
      this.lastDrawAt = Date.now();
    }
  }

  // The tiles the screen spans, with their screen positions
  _visibleTiles(center, zoom) {
    const z = utils.baseZoom(zoom);
    center = utils.ll2tile(center.lon, center.lat, z);
    
    const tiles = [];
    const tileSize = utils.tilesizeAtZoom(zoom);
    
    // a wide terminal or an export needs more than the 3 x 3 tiles around the centre
    const rx = Math.ceil(this.width / 2 / tileSize);
    const ry = Math.ceil(this.height / 2 / tileSize);
    for (let y = Math.floor(center.y) - ry; y <= Math.floor(center.y) + ry; y++) {
      for (let x = Math.floor(center.x) - rx; x <= Math.floor(center.x) + rx; x++) {
        const tile = {x, y, z};
        const position = {
          x: this.width / 2 - (center.x - tile.x) * tileSize,
          y: this.height / 2 - (center.y - tile.y) * tileSize,
        };
        
        const gridSize = Math.pow(2, z);
        
        tile.x %= gridSize;
        
        if (tile.x < 0) {
          tile.x = z === 0 ? 0 : tile.x + gridSize;
        }
        
        if (tile.y < 0 || tile.y >= gridSize || position.x + tileSize < 0 || position.y + tileSize < 0 || position.x > this.width || position.y > this.height) {
          continue;
        }
        
        tiles.push({
          xyz: tile,
          zoom,
          position,
          size: tileSize,
        });
      }
    }
    return tiles;
  }

  // Screen positions of the markers on screen
  _markerPositions(center, zoom, markers) {
    const positions = [];
    for (const marker of markers) {
      const {x, y} = this._project(center, zoom, marker);
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        positions.push({x, y});
      }
    }
    return positions;
  }

  // in pixels, the shorter way round the world (or, with near, the way closest to it, so lines cross the date line)
  _project(center, zoom, place, near = null) {
    const z = utils.baseZoom(zoom);
    const size = utils.tilesizeAtZoom(zoom);
    const gridSize = Math.pow(2, z);
    const c = utils.ll2tile(center.lon, center.lat, z);
    const m = utils.ll2tile(place.lon, utils.clamp(place.lat, -85.0511, 85.0511), z);
    let x = this.width / 2 + (m.x - c.x) * size;
    const world = gridSize * size;
    const target = near ? near.x : this.width / 2;
    while (x - target > world / 2) x -= world;
    while (target - x > world / 2) x += world;
    return {x: Math.round(x), y: Math.round(this.height / 2 + (m.y - c.y) * size)};
  }

  // view: 'map', 'satellite', 'hybrid', 'relief' or '3d'; rasters: {imagery, terrain}
  setView(view, rasters = this.rasters) {
    this.view = view;
    this.rasters = rasters;
  }

  // The picture sources the view uses
  _pictureSources() {
    const r = this.rasters || {};
    const sources = [];
    if (this.view === 'satellite' || this.view === 'hybrid' || (this.view === '3d' && this.photo3d)) sources.push(r.imagery);
    if (this.view === 'relief' || this.view === '3d') sources.push(r.terrain);
    return sources.filter(Boolean);
  }

  // How many picture tiles the view still waits for
  pendingPictures() {
    return this._pictureSources().reduce((sum, source) => sum + source.missing(), 0);
  }

  // How many picture tiles of the view couldn't be loaded lately
  failedPictures() {
    return this._pictureSources().reduce((sum, source) => sum + source.failures(), 0);
  }

  // Draws the picture under the map: imagery, or relief from the elevation
  _drawRaster(center, zoom) {
    const photo = this.view === 'satellite' || this.view === 'hybrid';
    const source = photo ? this.rasters.imagery : this.rasters.terrain;
    if (!source) return;
    // imagery goes deeper than the map tiles' zoom 14
    const z = Math.max(0, Math.min(source.maxZoom, Math.floor(zoom) + (photo ? config.imageryDetail : config.terrainDetail)));
    const c = utils.ll2tile(center.lon, center.lat, 0);
    const worldPixels = utils.tilesizeAtZoom(zoom) * Math.pow(2, utils.baseZoom(zoom));
    const columns = this.width >> 1;
    const rows = this.height >> 2;
    const buffer = this.canvas.buffer;
    // two samples per cell (top and bottom half), two pixels apart
    const x0 = c.x + (1 - this.width / 2) / worldPixels;
    const y0 = c.y + (1 - this.height / 2) / worldPixels;
    const step = 2 / worldPixels;
    const none = -1;
    if (photo) {
      for (let row = 0; row < rows; row++) {
        const wyTop = y0 + row * 2 * step;
        for (let col = 0; col < columns; col++) {
          const wx = x0 + col * step;
          const top = source.rgbAt(wx, wyTop, z);
          const bottom = source.rgbAt(wx, wyTop + step, z);
          if (top === none && bottom === none) continue;
          buffer.setRaster(col, row, top === none ? bottom : top, bottom === none ? top : bottom);
        }
      }
      return;
    }
    // relief: slopes measured k samples either way, at least one elevation pixel, or pixels show as blocks
    const metresPerStep = 40075016.7 * Math.cos(center.lat * Math.PI / 180) * step;
    const pixelMetres = 40075016.7 * Math.cos(center.lat * Math.PI / 180) / (256 * Math.pow(2, z));
    const k = Math.max(1, Math.min(32, Math.round(pixelMetres / metresPerStep)));
    const gridColumns = columns + 2 * k;
    const gridRows = rows * 2 + 2 * k;
    const heights = new Float64Array(gridColumns * gridRows);
    for (let j = 0; j < gridRows; j++) {
      for (let i = 0; i < gridColumns; i++) {
        const h = source.heightAt(x0 + (i - k) * step, y0 + (j - k) * step, z);
        heights[j * gridColumns + i] = h === null ? NaN : h;
      }
    }
    // steepen slopes where elevation pixels are coarse (they flatten hills), up to 3 times
    const exaggerate = Math.max(1, Math.min(3, pixelMetres / 100)) / (2 * k * metresPerStep);
    const lz = Math.SQRT1_2;
    const brightness = config.reliefBrightness;
    const shade = (i, j) => {
      const at = (j + k) * gridColumns + i + k;
      const h = heights[at];
      if (h !== h) return none;
      const east = heights[at + k];
      const west = heights[at - k];
      const south = heights[at + k * gridColumns];
      const north = heights[at - k * gridColumns];
      const dx = east !== east || west !== west ? 0 : (east - west) * exaggerate;
      const dy = south !== south || north !== north ? 0 : (south - north) * exaggerate;
      // light from the north-west, 45 degrees up
      const facing = Math.max(0, (dx * 0.5 + dy * 0.5 + lz) / Math.sqrt(dx * dx + dy * dy + 1));
      // flat 0.85, lit slopes up to ~1.2, shaded down to 0.4; the sea floor at half strength
      const light = 0.4 + 0.45 * facing / lz;
      return h < 0 ? tint(h, 0.85 + (Math.min(1.25, light) - 0.85) * 0.5) : tint(h, Math.min(1.25, light) * brightness);
    };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const top = shade(col, row * 2);
        const bottom = shade(col, row * 2 + 1);
        if (top === none && bottom === none) continue;
        buffer.setRaster(col, row, top === none ? bottom : top, bottom === none ? top : bottom);
      }
    }
  }

  // [{lines: [[{lat, lon}, ...]], points: [{lat, lon, name}], color, marker}]
  setOverlays(overlays) {
    this.overlays = overlays || [];
  }

  // Places the overlays' named points (before the map's labels)
  _placeOverlayPoints(center, zoom) {
    const placed = [];
    for (const overlay of this.overlays) {
      const color = x256(utils.hex2rgb(overlay.color || config.overlayColor));
      for (const point of overlay.points || []) {
        const {x, y} = this._project(center, zoom, point);
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        const symbol = overlay.marker || config.waypointMarker;
        const name = point.name ? utils.fitWidth(utils.shortenName(point.name, config.labelMaxWidth), (this.width >> 1) - 2, '…') : '';
        const text = name ? `${symbol} ${name}` : symbol;
        // at the point, else right or left of it, else just the symbol
        const width = stringWidth(text) * 2;
        const spots = [x, x + 6, x - width - 4].map((spot) => Math.max(0, Math.min(this.width - width, spot)));
        const spot = spots.find((candidate) => this.labelBuffer.writeIfPossible(text, candidate, y, null, 1));
        if (spot !== undefined) {
          placed.push({text, x: spot, y, color});
        } else if (this.labelBuffer.writeIfPossible(symbol, x, y, null, 0)) {
          placed.push({text: symbol, x, y, color});
        }
      }
    }
    return placed;
  }

  // Draws the overlays' lines
  _drawOverlayLines(center, zoom) {
    const world = Math.pow(2, utils.baseZoom(zoom)) * utils.tilesizeAtZoom(zoom);
    const c = utils.ll2tile(center.lon, center.lat, 0);
    for (const overlay of this.overlays) {
      const color = x256(utils.hex2rgb(overlay.color || config.overlayColor));
      for (const line of overlay.lines || []) {
        const positions = worldPositions(line);
        let previous = null;
        let points = [];
        for (let i = 0; i < positions.length; i += 2) {
          let x = this.width / 2 + (positions[i] - c.x) * world;
          const y = Math.round(this.height / 2 + (positions[i + 1] - c.y) * world);
          // the way round the world closest to the previous point
          const target = previous ? previous.x : this.width / 2;
          x -= Math.round((x - target) / world) * world;
          x = Math.round(x);
          if (previous && x === previous.x && y === previous.y) continue;
          previous = {x, y};
          points.push(previous);
        }
        if (points.length === 1) {
          points = [points[0], points[0]];
        }
        if (points.length) {
          this.canvas.polyline(points, color, 1);
        }
      }
    }
  }

  // whether the last frame was nearly empty with all tiles loaded (little mapped there)
  sparse() {
    const frame = this.lastFrame;
    return !!frame && !this.missingTiles && !this.failedCount && frame.filled < config.sparseFilled && frame.names <= 2;
  }

  // How many visible tiles were still loading in the last draw
  pendingTiles() {
    return this.missingTiles;
  }

  // Visible tiles that couldn't be loaded in the last draw: {count, reason}
  failedTiles() {
    return {count: this.failedCount || 0, reason: this.failReason};
  }

  // The visible tiles in memory, with stand-ins for the missing ones
  _resolveTiles(tiles) {
    const resolved = [];
    this.missingTiles = 0;
    this.failedCount = 0;
    this.failReason = null;
    for (const tile of tiles) {
      const {x, y, z} = tile.xyz;
      tile.data = this.tileSource.peekTile(z, x, y);
      if (tile.data) {
        resolved.push(tile);
        continue;
      }
      const rank = Math.hypot(
        tile.position.x + tile.size / 2 - this.width / 2,
        tile.position.y + tile.size / 2 - this.height / 2
      );
      this.tileSource.requestTile(z, x, y, rank);
      if (this.tileSource.isLoading(z, x, y)) {
        this.missingTiles++;
      } else if (this.tileSource.failureOf(z, x, y)) {
        this.failedCount++;
        this.failReason = this.tileSource.failureOf(z, x, y);
      }

      const clip = {
        minX: tile.position.x,
        minY: tile.position.y,
        maxX: tile.position.x + tile.size,
        maxY: tile.position.y + tile.size,
      };
      const children = this._childTiles(tile, clip);
      const ancestor = this._ancestorTile(tile, clip, z);
      if (!ancestor && children.length < 4 && z > 0) {
        // Fetch the parent first: it covers four tiles. The world tile stands in until then (slow links).
        this.tileSource.requestTile(0, 0, 0, -2);
        this.tileSource.requestTile(z - 1, x >> 1, y >> 1, -1);
      }
      resolved.push(...(
        this._ancestorTile(tile, clip, 1) ||
        (children.length === 4 && children) ||
        ancestor ||
        children
      ));
    }
    return resolved;
  }

  // the recent pan and zoom direction, so prefetching starts where the user is heading
  _trackMovement(center, zoom) {
    const z = utils.baseZoom(zoom);
    const size = utils.tilesizeAtZoom(zoom);
    const tile = utils.ll2tile(center.lon, center.lat, z);
    const last = this.lastView;
    if (last && last.z === z) {
      const gridSize = Math.pow(2, z);
      let dx = tile.x - last.x;
      if (dx > gridSize / 2) dx -= gridSize;
      if (dx < -gridSize / 2) dx += gridSize;
      this.movement = {
        x: this.movement.x / 2 + dx * size,
        y: this.movement.y / 2 + (tile.y - last.y) * size,
      };
    } else {
      this.movement = {x: 0, y: 0};
    }
    if (last && zoom !== last.zoom) {
      this.zoomTrend = Math.sign(zoom - last.zoom);
    }
    this.lastView = {x: tile.x, y: tile.y, z, zoom};
  }

  // When nothing visible is waiting, prefetch the ring around the view and one zoom in and out, ahead first.
  _prefetchAround(center, zoom) {
    const z = utils.baseZoom(zoom);
    const levels = [z, z + 1, z - 1].filter((level) => level >= 0 && level <= config.tileRange);
    const speed = Math.hypot(this.movement.x, this.movement.y);
    const ahead = speed ? {
      x: this.movement.x / speed * this.width / 2,
      y: this.movement.y / speed * this.height / 2,
    } : {x: 0, y: 0};
    for (const level of levels) {
      const levelPenalty = level === z ? 0 : (Math.sign(level - z) === this.zoomTrend ? -this.width : this.width);
      const c = utils.ll2tile(center.lon, center.lat, level);
      const tileSize = utils.tilesizeAtZoom(zoom) * Math.pow(2, level - z);
      const rx = Math.ceil(this.width / 2 / tileSize) + (level === z ? 1 : 0);
      const ry = Math.ceil(this.height / 2 / tileSize) + (level === z ? 1 : 0);
      const gridSize = Math.pow(2, level);
      for (let y = Math.floor(c.y) - ry; y <= Math.floor(c.y) + ry; y++) {
        if (y < 0 || y >= gridSize) {
          continue;
        }
        for (let x = Math.floor(c.x) - rx; x <= Math.floor(c.x) + rx; x++) {
          const rank = levelPenalty + Math.hypot(
            (x + 0.5 - c.x) * tileSize - ahead.x,
            (y + 0.5 - c.y) * tileSize - ahead.y
          );
          this.tileSource.prefetchTile(level, ((x % gridSize) + gridSize) % gridSize, y, rank);
        }
      }
    }
  }

  // The closest coarser tile in memory covering a tile, scaled up
  _ancestorTile(tile, clip, maxDepth) {
    const {x, y, z} = tile.xyz;
    for (let dz = 1; dz <= Math.min(maxDepth, z); dz++) {
      const ax = x >> dz;
      const ay = y >> dz;
      const data = this.tileSource.peekTile(z - dz, ax, ay);
      if (data) {
        return [{
          xyz: {x: ax, y: ay, z: z - dz},
          zoom: tile.zoom,
          position: {
            x: tile.position.x - (x - (ax << dz)) * tile.size,
            y: tile.position.y - (y - (ay << dz)) * tile.size,
          },
          size: tile.size * (1 << dz),
          data,
          clip,
        }];
      }
    }
    return null;
  }

  // The finer tiles in memory covering a tile, e.g. after zooming out
  _childTiles(tile, clip) {
    const {x, y, z} = tile.xyz;
    const children = [];
    if (z + 1 > config.tileRange) {
      return children;
    }
    const size = tile.size / 2;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const data = this.tileSource.peekTile(z + 1, x * 2 + dx, y * 2 + dy);
        if (data) {
          const position = {
            x: tile.position.x + dx * size,
            y: tile.position.y + dy * size,
          };
          children.push({
            xyz: {x: x * 2 + dx, y: y * 2 + dy, z: z + 1},
            zoom: tile.zoom,
            position,
            size,
            data,
            clip: {
              minX: Math.max(clip.minX, position.x),
              minY: Math.max(clip.minY, position.y),
              maxX: Math.min(clip.maxX, position.x + size),
              maxY: Math.min(clip.maxY, position.y + size),
            },
          });
        }
      }
    }
    return children;
  }

  // A tile's features within the clip, by layer
  _getTileFeatures(tile, zoom) {
    const position = tile.position;
    const layers = {};
    const drawOrder = this._generateDrawOrder(utils.baseZoom(zoom));

    const area = {minX: 0, minY: 0, maxX: this.width, maxY: this.height};
    if (tile.clip) {
      area.minX = Math.max(area.minX, tile.clip.minX);
      area.minY = Math.max(area.minY, tile.clip.minY);
      area.maxX = Math.min(area.maxX, tile.clip.maxX);
      area.maxY = Math.min(area.maxY, tile.clip.maxY);
    }

    for (const layerId of drawOrder) {
      const layer = (tile.data.layers || {})[layerId];
      if (!layer) {
        continue;
      }

      const scale = layer.extent / tile.size;
      layers[layerId] = {
        scale: scale,
        features: layer.tree.search({
          minX: (area.minX - position.x) * scale,
          minY: (area.minY - position.y) * scale,
          maxX: (area.maxX - position.x) * scale,
          maxY: (area.maxY - position.y) * scale
        }),
      };
    }
    tile.layers = layers;
    return tile;
  }

  // Draws the tiles' features in style order, then their labels
  _renderTiles(tiles, zoom) {
    const labels = [];
    if (tiles.length === 0) return;
    
    const drawOrder = this._generateDrawOrder(utils.baseZoom(zoom));
    for (const layerId of drawOrder) {
      for (const tile of tiles) {
        const layer = tile.layers[layerId];
        if (!layer) continue;
        this.canvas.setClip(tile.clip);
        for (const feature of layer.features) {
          // continue if feature.id and drawn[feature.id]
          // drawn[feature.id] = true;
          if (layerId.match(/label/)) {
            labels.push({
              tile,
              feature,
              scale: layer.scale
            });
          } else if (this.view !== 'satellite' && ((this.view !== 'hybrid' && this.view !== 'relief') ||
            (feature.style.type === 'line' && !AREA_LAYERS.has(layerId)))) {
            // over pictures only names (and in hybrid and relief lines); filled areas would flatten them
            this._drawFeature(tile, feature, layer.scale);
          }
        }
      }
    }
    this.canvas.setClip(null);

    // by layer, then by the feature's rank
    const priority = (label) => {
      const index = labelPriority.indexOf(label.feature.layer);
      return index === -1 ? labelPriority.length : index;
    };
    const rank = (label) => label.feature.sort || 0;
    const expanded = (label) => label.feature.label === this.expandedLabel ? 0 : 1;
    labels.sort((a, b) => expanded(a) - expanded(b) || priority(a) - priority(b) || rank(a) - rank(b));

    // place every name that fits first, so markers never take a name's space
    const unplaced = [];
    for (const label of labels) {
      if (this._drawFeature(label.tile, label.feature, label.scale) === null) {
        unplaced.push(label);
      }
    }
    for (const label of unplaced) {
      if ((config.layers[label.feature.layer] || {}).cluster) {
        this._drawMarker(label.tile, label.feature, label.scale);
      }
    }
  }

  // only changed rows are sent, as one synchronized frame
  _getFrame() {
    const lines = this.canvas.frameLines();
    const previous = this.previousLines;
    let frame = this.terminal.SYNC_START;
    if (!this.lastDrawAt) {
      frame += this.terminal.CLEAR;
    }
    if (previous && previous.length === lines.length) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== previous[i]) {
          frame += `\x1B[${i + 1};1H` + lines[i];
        }
      }
      frame += this.terminal.RESET + `\x1B[${lines.length + 1};1H`;
    } else {
      frame += this.terminal.MOVE + lines.join(config.delimeter) + this.terminal.RESET + config.delimeter;
    }
    this.previousLines = lines;
    return frame + this.terminal.SYNC_END;
  }

  // The labels at a cell
  featuresAt(x, y) {
    return this.labelBuffer.featuresAt(x, y);
  }

  // The full name of the label at a cell or next to it, as last drawn, or null
  labelAt(column, row) {
    const hits = this.featuresAt(column, row).filter((hit) => hit.feature && hit.feature.label);
    if (!hits.length) {
      return null;
    }
    const distance = (hit) => Math.abs(row - (hit.minY + hit.maxY) / 2) * 4 + Math.abs(column - (hit.minX + hit.maxX) / 2);
    hits.sort((a, b) => distance(a) - distance(b));
    return hits[0].feature.label;
  }

  // The shortened names of the last frame, in reading order
  shortenedNames() {
    return this.shortenedLabels.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((label) => label.label);
  }

  // Shows this name in full from the next draw on (null: none)
  expandLabel(name) {
    this.expandedLabel = name;
  }

  // Draws one feature: a line, an area, a label or a marker
  _drawFeature(tile, feature, scale) {
    let points;
    // names may appear a few zoom levels early (config.labelsEarly) if there is room
    const early = feature.style.type === 'symbol' ? config.labelsEarly : 0;
    if (feature.style.minzoom && tile.zoom + early < feature.style.minzoom) {
      return false;
    } else if (feature.style.maxzoom && tile.zoom > feature.style.maxzoom) {
      return false;
    }
    
    switch (feature.style.type) {
      case 'line': {
        let width = feature.style.paint['line-width'];
        if (width instanceof Object) {
          // TODO: apply the correct zoom based value
          width = width.stops[0][1];
        }
        points = this._scaleAndReduce(tile, feature, feature.points, scale);
        if (points.length) {
          this.canvas.polyline(points, feature.color, width);
        }
        break;
      }
      case 'fill': {
        points = feature.points.map((p) => {
          return this._scaleAndReduce(tile, feature, p, scale, false);
        });
        this.canvas.polygon(points, feature.color);
        break;
      }
      case 'symbol': {
        return this._drawLabel(tile, feature, scale) ? true : null;
      }
    }
    return true;
  }

  // Places a feature's label where it fits; null if it didn't
  _drawLabel(tile, feature, scale) {
    if (!feature.label) {
      return false;
    }
    // long names are shortened, except the one clicked on, and none is wider than the screen
    const name = feature.label === this.expandedLabel ? feature.label : utils.shortenName(feature.label, config.labelMaxWidth);
    const text = utils.fitWidth(name, this.width >> 1, '…');
    const layerMargin = (config.layers[feature.layer] || {}).margin;
    const margin = layerMargin || config.labelMargin;
    // two pixels per column; CJK characters take two columns
    const width = stringWidth(text) * 2;

    for (const point of this._scaleAndReduce(tile, feature, feature.points, scale)) {
      if (!this._labelAnchorUsable(tile, point)) {
        continue;
      }
      // the same name only shows again far from its other copies
      if (this._seenNearby(text, point)) {
        return true;
      }
      const x = Math.max(0, Math.min(this.width - width, point.x - width / 2));
      // a place name (not a road's) may move a row up or down when its spot is taken
      const rows = feature.points.length === 1 ? [0, -4, 4] : [0];
      for (const dy of rows) {
        const y = point.y + dy;
        if (y < 0 || y >= this.height) continue;
        if (this.labelBuffer.writeIfPossible(text, x, y, feature, margin)) {
          this.canvas.text(text, x, y, feature.color);
          const shortened = text !== feature.label || feature.label === this.expandedLabel;
          if (shortened && !this._shortened.some((other) => other.label === feature.label)) {
            this._shortened.push({label: feature.label, x: Math.floor(x / 2), y: Math.floor(y / 4)});
          }
          this._seen[text] = (this._seen[text] || []).concat(point);
          return true;
        }
      }
    }
    return false;
  }

  // Draws a point feature's marker where it is free
  _drawMarker(tile, feature, scale) {
    for (const point of this._scaleAndReduce(tile, feature, feature.points, scale)) {
      if (!this._labelAnchorUsable(tile, point)) {
        continue;
      }
      if (this.labelBuffer.writeIfPossible(config.poiMarker, point.x, point.y, feature, 3)) {
        this.canvas.text(config.poiMarker, point.x, point.y, feature.color);
        return true;
      }
    }
    return false;
  }

  // Whether a point is on screen and inside its tile's clip
  _labelAnchorUsable(tile, point) {
    if (point.x < 0 || point.x >= this.width || point.y < 0 || point.y >= this.height) {
      return false;
    }
    return !tile.clip || this._insideClip(tile.clip, point);
  }

  // Whether the same text was placed close to this point already
  _seenNearby(text, point) {
    const seen = this._seen[text];
    if (!seen) {
      return false;
    }
    return seen.some((other) => {
      return Math.abs(other.x - point.x) < config.labelRepeatDistance.x &&
        Math.abs(other.y - point.y) < config.labelRepeatDistance.y;
    });
  }

  // Whether a point lies inside the clip
  _insideClip(clip, point) {
    return point.x >= clip.minX && point.x < clip.maxX && point.y >= clip.minY && point.y < clip.maxY;
  }

  // A feature's points on screen, without consecutive duplicates
  _scaleAndReduce(tile, feature, points, scale, filter = true) {
    let lastX;
    let lastY;
    let outside;
    const scaled = [];
    
    const minX = -this.tilePadding;
    const minY = -this.tilePadding;
    const maxX = this.width + this.tilePadding;
    const maxY = this.height + this.tilePadding;
    
    for (const point of points) {
      const x = Math.floor(tile.position.x + (point.x / scale));
      const y = Math.floor(tile.position.y + (point.y / scale));
      if (lastX === x && lastY === y) {
        continue;
      }
      lastY = y;
      lastX = x;
      if (filter) {
        if (x < minX || x > maxX || y < minY || y > maxY) {
          if (outside) {
            continue;
          }
          outside = true;
        } else {
          if (outside) {
            outside = null;
            scaled.push({x: lastX, y: lastY});
          }
        }
      }
      scaled.push({x, y});
    }
    if (feature.style.type !== 'symbol') {
      if (scaled.length < 2) {
        return [];
      }
      if (config.simplifyPolylines) {
        return simplify(scaled, .5, true);
      } else {
        return scaled;
      }
    } else {
      return scaled;
    }
  }

  // The style layers in drawing order for a zoom
  _generateDrawOrder(zoom) {
    if (zoom < 2) {
      return [
        'admin',
        'water',
        'country_label',
        'marine_label',
      ];
    } else {
      return [
        'landuse',
        'water',
        // in empty land (e.g. Siberia) rivers are most of what there is
        'waterway',
        'marine_label',
        'building',
        'road',
        'admin',
        'country_label',
        'state_label',
        'water_label',
        'place_label',
        'rail_station_label',
        'airport_label',
        'poi_label',
        'road_label',
        'housenum_label',
      ];
    }
  }
}

Renderer.prototype.terminal = {
  CLEAR: '\x1B[2J',
  MOVE: '\x1B[?6h',
  RESET: '\x1B[39;49m',
  SYNC_START: '\x1B[?2026h',
  SYNC_END: '\x1B[?2026l',
};

Renderer.prototype.isDrawing = false;
Renderer.prototype.lastDrawAt = 0;
Renderer.prototype.labelBuffer = null;
Renderer.prototype.tileSource = null;
Renderer.prototype.tilePadding = 64;
Renderer.prototype.missingTiles = 0;
Renderer.prototype.movement = {x: 0, y: 0};
Renderer.prototype.zoomTrend = 1;
Renderer.prototype.lastView = null;

// area layers, left out over pictures
const AREA_LAYERS = new Set(['building', 'landuse', 'landcover', 'park', 'water', 'aeroway_area']);

// sea floor in blues by depth; land from green over brown to grey and white
const RAMP = [
  [-6000, [8, 22, 60]], [-1000, [20, 50, 110]], [-1, [40, 80, 140]],
  [0, [58, 98, 58]], [300, [92, 130, 70]], [800, [150, 150, 90]], [1500, [140, 110, 80]],
  [2500, [130, 125, 120]], [3500, [190, 190, 190]], [5000, [245, 245, 250]],
];
// The colour of a height, times light
function tint(h, light) {
  let i = 0;
  while (i < RAMP.length - 2 && h > RAMP[i + 1][0]) i++;
  const [h0, c0] = RAMP[i];
  const [h1, c1] = RAMP[i + 1];
  const t = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
  const c = (k) => Math.max(0, Math.min(255, Math.round((c0[k] + (c1[k] - c0[k]) * t) * light)));
  return (c(0) << 16) | (c(1) << 8) | c(2);
}

// flat [x0, y0, ...] in world units, computed once per line: GPS tracks can have 100,000s of points
const worldCache = new WeakMap();
// A line's points in world units as a flat array, cached per line
function worldPositions(line) {
  let positions = worldCache.get(line);
  if (!positions) {
    positions = new Float64Array(line.length * 2);
    line.forEach((place, i) => {
      const p = utils.ll2tile(place.lon, utils.clamp(place.lat, -85.0511, 85.0511), 0);
      positions[i * 2] = p.x;
      positions[i * 2 + 1] = p.y;
    });
    worldCache.set(line, positions);
  }
  return positions;
}

Renderer.tint = tint;
module.exports = Renderer;
