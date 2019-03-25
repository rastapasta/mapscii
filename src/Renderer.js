/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer - bäm!
*/
'use strict';
const Promise = require('bluebird');
const x256 = require('x256');
const simplify = require('simplify-js');

const Canvas = require('./Canvas');
const LabelBuffer = require('./LabelBuffer');
const Styler = require('./Styler');
const utils = require('./utils');
const config = require('./config');

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
  }

  draw(center, zoom) {
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

    return Promise.resolve(this._visibleTiles(center, zoom)).map((tile) => {
      return this._getTile(tile);
    }).map((tile) => {
      return this._getTileFeatures(tile, zoom);
    }).then((tiles) => {
      this._renderTiles(tiles);
    }).then(() => {
      return this._getFrame();
    }).catch((e) => {
      return console.log(e);
    }).finally((frame) => {
      this.isDrawing = false;
      this.lastDrawAt = Date.now();
      return frame;
    });
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

  _getTile(tile) {
    return this.tileSource
      .getTile(tile.xyz.z, tile.xyz.x, tile.xyz.y)
      .then((data) => {
        tile.data = data;
        return tile;
      });
  }

  _getTileFeatures(tile, zoom) {
    const position = tile.position;
    const layers = {};
    const drawOrder = this._generateDrawOrder(zoom);
    for (const layerId of drawOrder) {
      const layer = (tile.data.layers || {})[layerId];
      if (!layer) {
        continue;
      }
      
      const scale = layer.extent / utils.tilesizeAtZoom(zoom);
      layers[layerId] = {
        scale: scale,
        features: layer.tree.search({
          minX: -position.x * scale,
          minY: -position.y * scale,
          maxX: (this.width - position.x) * scale,
          maxY: (this.height - position.y) * scale
        }),
      };
    }
    tile.layers = layers;
    return tile;
  }

  _renderTiles(tiles) {
    const labels = [];
    
    const drawOrder = this._generateDrawOrder(tiles[0].xyz.z);
    for (const layerId of drawOrder) {
      for (const tile of tiles) {
        const layer = tile.layers[layerId];
        if (!layer) continue;
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

    labels.sort((a, b) => {
      return a.feature.sorty - b.feature.sort;
    });

    for (const label of labels) {
      this._drawFeature(label.tile, label.feature, label.scale);
    }
  }

  _getFrame() {
    let frame = '';
    if (!this.lastDrawAt) {
      frame += this.terminal.CLEAR;
    }
    frame += this.terminal.MOVE;
    frame += this.canvas.frame();
    return frame;
  }

  featuresAt(x, y) {
    return this.labelBuffer.featuresAt(x, y);
  }

  _drawFeature(tile, feature, scale) {
    let points, placed;
    if (feature.style.minzoom && tile.zoom < feature.style.minzoom) {
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
        const genericSymbol = config.poiMarker;
        const text = feature.label || config.poiMarker;
        
        if (this._seen[text] && !genericSymbol) {
          return false;
        }
        
        placed = false;
        const pointsOfInterest = this._scaleAndReduce(tile, feature, feature.points, scale);
        for (const point of pointsOfInterest) {
          const x = point.x - text.length;
          const layerMargin = (config.layers[feature.layer] || {}).margin;
          const margin = layerMargin || config.labelMargin;
          if (this.labelBuffer.writeIfPossible(text, x, point.y, feature, margin)) {
            this.canvas.text(text, x, point.y, feature.color);
            placed = true;
            break;
          } else {
            const cluster = (config.layers[feature.layer] || {}).cluster;
            if (cluster && this.labelBuffer.writeIfPossible(config.poiMarker, point.x, point.y, feature, 3)) {
              this.canvas.text(config.poiMarker, point.x, point.y, feature.color);
              placed = true;
              break;
            }
          }
        }
        if (placed) {
          this._seen[text] = true;
        }
        break;
      }
    }
    return true;
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
};

Renderer.prototype.isDrawing = false;
Renderer.prototype.lastDrawAt = 0;
Renderer.prototype.labelBuffer = null;
Renderer.prototype.tileSource = null;
Renderer.prototype.tilePadding = 64;

module.exports = Renderer;
