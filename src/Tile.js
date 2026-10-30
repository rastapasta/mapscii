/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Handling of and access to single VectorTiles
*/
'use strict';
const VectorTile = require('@mapbox/vector-tile').VectorTile;
const Protobuf = require('pbf');
const zlib = require('zlib');
const RBush = require('rbush');
const x256 = require('x256');

const config = require('./config');
const utils = require('./utils');
const OpenMapTiles = require('./OpenMapTiles');

const schemas = {
  openmaptiles: OpenMapTiles.translate,
};

class Tile {
  // schema: the tile source's data schema; anything but osm2vectortiles gets
  // translated into it, which is what the styles are written for
  constructor(styler, schema) {
    this.styler = styler;
    this.translate = schemas[schema] || null;
  }

  load(buffer) {
    return this._unzipIfNeeded(buffer).then((buffer) => {
      return this._loadTile(buffer);
    }).then(() => {
      return this._loadLayers();
    }).then(() => {
      return this;
    });
  }

  _loadTile(buffer) {
    this.tile = new VectorTile(new Protobuf(buffer));
  }

  _unzipIfNeeded(buffer) {
    return new Promise((resolve, reject) => {
      if (this._isGzipped(buffer)) {
        zlib.gunzip(buffer, (err, data) => {
          if (err) {
            reject(err);
          }
          resolve(data);
        });
      } else {
        resolve(buffer);
      }
    });
  }

  _isGzipped(buffer) {
    return buffer.slice(0, 2).indexOf(Buffer.from([0x1f, 0x8b])) === 0;
  }

  _loadLayers() {
    const nodesByLayer = {};
    const extents = {};
    const colorCache = {};
    for (const sourceLayer in this.tile.layers) {
      const layer = this.tile.layers[sourceLayer];
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i);
        const type = [undefined, 'Point', 'LineString', 'Polygon'][feature.type];
        let name = sourceLayer;
        if (this.translate) {
          const translated = this.translate(sourceLayer, feature.properties, type);
          if (!translated) {
            continue;
          }
          name = translated.layer;
          feature.properties = translated.properties;
        }
        feature.properties.$type = type;
        let style;
        if (this.styler) {
          style = this.styler.getStyleFor(name, feature);
          if (!style) {
            continue;
          }
        }
        let color = (
          style.paint['line-color'] ||
          style.paint['fill-color'] ||
          style.paint['text-color']
        );
        // TODO: style zoom stops handling
        if (color instanceof Object) {
          color = color.stops[0][1];
        }
        const colorCode = colorCache[color] || (colorCache[color] = x256(utils.hex2rgb(color)));
        // TODO: monkey patching test case for tiles with a reduced extent 4096 / 8 -> 512
        // use feature.loadGeometry() again as soon as we got a 512 extent tileset
        const geometries = feature.loadGeometry(); //@_reduceGeometry feature, 8
        const sort = feature.properties.localrank || feature.properties.scalerank;
        const label = style.type === 'symbol' ? feature.properties['name_' + config.language] || feature.properties.name_en || feature.properties.name || feature.properties.house_num : void 0;
        const nodes = nodesByLayer[name] || (nodesByLayer[name] = []);
        extents[name] = layer.extent;
        if (style.type === 'fill') {
          // one feature can hold several polygons, each an outer ring followed by its holes
          for (const polygon of classifyRings(geometries)) {
            nodes.push(this._addBoundaries(true, {
              //            id: feature.id
              layer: name,
              style,
              label,
              sort,
              points: polygon,
              color: colorCode,
            }));
          }
        } else {
          for (const points of geometries) {
            nodes.push(this._addBoundaries(false, {
              //id: feature.id,
              layer: name,
              style,
              label,
              sort,
              points,
              color: colorCode,
            }));
          }
        }
      }
    }

    const layers = {};
    for (const name in nodesByLayer) {
      const tree = new RBush(18);
      tree.load(nodesByLayer[name]);
      layers[name] = {
        extent: extents[name],
        tree,
      };
    }
    return this.layers = layers;
  }

  _addBoundaries(deep, data) {
    let minX = 2e308;
    let maxX = -2e308;
    let minY = 2e308;
    let maxY = -2e308;
    const points = (deep ? data.points[0] : data.points);
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    data.minX = minX;
    data.maxX = maxX;
    data.minY = minY;
    data.maxY = maxY;
    return data;
  }

  _reduceGeometry(feature, factor) {
    const results = [];
    const geometries = feature.loadGeometry();
    for (const points of geometries) {
      const reduced = [];
      let last;
      for (const point of points) {
        const p = {
          x: Math.floor(point.x / factor),
          y: Math.floor(point.y / factor)
        };
        if (last && last.x === p.x && last.y === p.y) {
          continue;
        }
        reduced.push(last = p);
      }
      results.push(reduced);
    }
    return results;
  }
}

// Splits the rings of a polygon feature into polygons: the first ring's winding
// order marks outer rings, the opposite order holes of the polygon before.
// (The same approach as classifyRings in @mapbox/vector-tile.)
function classifyRings(rings) {
  if (rings.length <= 1) {
    return [rings];
  }
  const polygons = [];
  let polygon = null;
  let outerIsNegative;
  for (const ring of rings) {
    const area = signedArea(ring);
    if (area === 0) {
      continue;
    }
    if (outerIsNegative === undefined) {
      outerIsNegative = area < 0;
    }
    if (outerIsNegative === area < 0) {
      if (polygon) {
        polygons.push(polygon);
      }
      polygon = [ring];
    } else if (polygon) {
      polygon.push(ring);
    }
  }
  if (polygon) {
    polygons.push(polygon);
  }
  return polygons;
}

function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x - ring[i].x) * (ring[i].y + ring[j].y);
  }
  return sum;
}

Tile.prototype.layers = {};
Tile.classifyRings = classifyRings;

module.exports = Tile;
