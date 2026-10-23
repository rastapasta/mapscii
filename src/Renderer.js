/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
*/
'use strict';
const x256 = require('x256');
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
    this.styler = new Styler(style);
    this.tileSource.useStyler(this.styler);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.canvas = new Canvas(width, height);
    this.previousLines = null;
  }

  async draw(center, zoom) {
    if (this.isDrawing) return Promise.reject();
    this.isDrawing = true;

    this.labelBuffer.clear();
    this._seen = {};

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

    try {
      // Only tiles already in memory get drawn - missing ones are requested in the
      // background and stood in for by a lower or higher zoom level until they arrive
      this.tileSource.beginFrame();
      this._trackMovement(center, zoom);
      const tiles = this._resolveTiles(this._visibleTiles(center, zoom));
      if (this.missingTiles === 0 && config.prefetch) {
        this._prefetchAround(center, zoom);
      }
      for (const tile of tiles) {
        this._getTileFeatures(tile, zoom);
      }
      this._renderTiles(tiles, zoom);
      return this._getFrame();
    } catch(e) {
      console.error(e);
    } finally {
      this.isDrawing = false;
      this.lastDrawAt = Date.now();
    }
  }

  _visibleTiles(center, zoom) {
    const z = utils.baseZoom(zoom);
    center = utils.ll2tile(center.lon, center.lat, z);
    
    const tiles = [];
    const tileSize = utils.tilesizeAtZoom(zoom);
    
    for (let y = Math.floor(center.y) - 1; y <= Math.floor(center.y) + 1; y++) {
      for (let x = Math.floor(center.x) - 1; x <= Math.floor(center.x) + 1; x++) {
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

  // Number of visible tiles which were still loading during the last draw
  pendingTiles() {
    return this.missingTiles;
  }

  _resolveTiles(tiles) {
    const resolved = [];
    this.missingTiles = 0;
    for (const tile of tiles) {
      const {x, y, z} = tile.xyz;
      tile.data = this.tileSource.peekTile(z, x, y);
      if (tile.data) {
        resolved.push(tile);
        continue;
      }
      // the tile in the middle of the screen is the most important one
      const rank = Math.hypot(
        tile.position.x + tile.size / 2 - this.width / 2,
        tile.position.y + tile.size / 2 - this.height / 2
      );
      this.tileSource.requestTile(z, x, y, rank);
      if (this.tileSource.isLoading(z, x, y)) {
        this.missingTiles++;
      }

      // stand-ins must stay within the area of the missing tile
      const clip = {
        minX: tile.position.x,
        minY: tile.position.y,
        maxX: tile.position.x + tile.size,
        maxY: tile.position.y + tile.size,
      };
      const children = this._childTiles(tile, clip);
      const ancestor = this._ancestorTile(tile, clip, z);
      if (!ancestor && children.length < 4 && z > 0) {
        // nothing to show here yet: the parent tile covers four tiles at once,
        // so getting it first fills the screen sooner
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

  // Remembers in which direction the user has been panning and zooming lately,
  // so prefetching can start where they are heading
  _trackMovement(center, zoom) {
    const z = utils.baseZoom(zoom);
    const size = utils.tilesizeAtZoom(zoom);
    const tile = utils.ll2tile(center.lon, center.lat, z);
    const last = this.lastView;
    if (last && last.z === z) {
      // in screen pixels, older movements fade out
      this.movement = {
        x: this.movement.x / 2 + (tile.x - last.x) * size,
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

  // Downloads, when no visible tile is waiting, what the user will most likely look
  // at next: the ring of tiles around the view, and the view one zoom level in and
  // out - starting with what lies in the direction they are moving
  _prefetchAround(center, zoom) {
    const z = utils.baseZoom(zoom);
    const levels = [z, z + 1, z - 1].filter((level) => level >= 0 && level <= config.tileRange);
    // where the screen centre will probably be soon, in pixels from the current one
    const speed = Math.hypot(this.movement.x, this.movement.y);
    const ahead = speed ? {
      x: this.movement.x / speed * this.width / 2,
      y: this.movement.y / speed * this.height / 2,
    } : {x: 0, y: 0};
    for (const level of levels) {
      // the zoom level the user is heading to comes first
      const levelPenalty = level === z ? 0 : (Math.sign(level - z) === this.zoomTrend ? -this.width : this.width);
      const c = utils.ll2tile(center.lon, center.lat, level);
      // how many tiles the screen spans at this level
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

  // the closest lower zoom tile in memory which covers the given tile, scaled up
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

  // the next higher zoom tiles in memory covering the given tile (e.g. after zooming out)
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

  _getTileFeatures(tile, zoom) {
    const position = tile.position;
    const layers = {};
    const drawOrder = this._generateDrawOrder(utils.baseZoom(zoom));

    // only look for features within the screen - or the clipped part of it
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
          } else {
            this._drawFeature(tile, feature, layer.scale);
          }
        }
      }
    }
    this.canvas.setClip(null);

    // Most important names first: by layer (cities before shops before house
    // numbers), then by the feature's own rank within its layer
    const priority = (label) => {
      const index = labelPriority.indexOf(label.feature.layer);
      return index === -1 ? labelPriority.length : index;
    };
    const rank = (label) => label.feature.sort || 0;
    labels.sort((a, b) => priority(a) - priority(b) || rank(a) - rank(b));

    // Place as many names as fit, and only then mark the rest with a symbol,
    // so markers never take the space of a name
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

  // Only rows which changed since the last frame get sent to the terminal, and
  // the terminal is asked to show the frame at once instead of while it arrives
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
      // leave the cursor below the map, where the footer gets written
      frame += this.terminal.RESET + `\x1B[${lines.length + 1};1H`;
    } else {
      frame += this.terminal.MOVE + lines.join(config.delimeter) + this.terminal.RESET + config.delimeter;
    }
    this.previousLines = lines;
    return frame + this.terminal.SYNC_END;
  }

  featuresAt(x, y) {
    return this.labelBuffer.featuresAt(x, y);
  }

  _drawFeature(tile, feature, scale) {
    let points;
    // with config.showAllLabels names don't wait for their zoom level - they
    // show whenever there is room for them, most important first
    const ignoreMinzoom = feature.style.type === 'symbol' && config.showAllLabels;
    if (feature.style.minzoom && tile.zoom < feature.style.minzoom && !ignoreMinzoom) {
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
        // null tells the caller that the label didn't fit
        return this._drawLabel(tile, feature, scale) ? true : null;
      }
    }
    return true;
  }

  _drawLabel(tile, feature, scale) {
    const text = feature.label;
    if (!text) {
      return false;
    }
    const layerMargin = (config.layers[feature.layer] || {}).margin;
    const margin = layerMargin || config.labelMargin;
    const width = text.length * 2;

    for (const point of this._scaleAndReduce(tile, feature, feature.points, scale)) {
      if (!this._labelAnchorUsable(tile, point)) {
        continue;
      }
      // the same name (e.g. a long street) only shows again far away from its other copies
      if (this._seenNearby(text, point)) {
        return true;
      }
      // keep the whole name on screen instead of cutting it off at the edge
      const x = Math.max(0, Math.min(this.width - width, point.x - text.length));
      if (this.labelBuffer.writeIfPossible(text, x, point.y, feature, margin)) {
        this.canvas.text(text, x, point.y, feature.color);
        this._seen[text] = (this._seen[text] || []).concat(point);
        return true;
      }
    }
    return false;
  }

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

  _labelAnchorUsable(tile, point) {
    if (point.x < 0 || point.x >= this.width || point.y < 0 || point.y >= this.height) {
      return false;
    }
    return !tile.clip || this._insideClip(tile.clip, point);
  }

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

  _insideClip(clip, point) {
    return point.x >= clip.minX && point.x < clip.maxX && point.y >= clip.minY && point.y < clip.maxY;
  }

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
  // synchronized output: terminals without support simply ignore these
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

module.exports = Renderer;
