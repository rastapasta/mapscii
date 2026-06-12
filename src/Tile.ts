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

class Tile {
  constructor(styler) {
    this.styler = styler;
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
    const layers = {};
    const colorCache = {};
    for (const name in this.tile.layers) {
      const layer = this.tile.layers[name];
      const nodes = [];
      //continue if name is 'water'
      for (let i = 0; i < layer.length; i++) {
        // TODO: caching of similar attributes to avoid looking up the style each time
        //continue if @styler and not @styler.getStyleFor layer, feature

        const feature = layer.feature(i);
        feature.properties.$type = [undefined, 'Point', 'LineString', 'Polygon'][feature.type];
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
        if (style.type === 'fill') {
          nodes.push(this._addBoundaries(true, {
            //            id: feature.id
            layer: name,
            style,
            label,
            sort,
            points: geometries,
            color: colorCode,
          }));
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
      const tree = new RBush(18);
      tree.load(nodes);
      layers[name] = {
        extent: layer.extent,
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

Tile.prototype.layers = {};

module.exports = Tile;
