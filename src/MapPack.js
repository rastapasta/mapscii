// Map packs: the tiles of an area, or the whole cache, in one MBTiles file.
'use strict';
const fs = require('fs');
const path = require('path');
const MBTilesFile = require('./MBTilesFile');
const utils = require('./utils');

// [{z, x, y, file}] of the area, or of the whole cache if area is null
function cachedTiles(tileSource, area) {
  if (area) {
    return tileSource.areaTiles(area.lat, area.lon, area.radiusKm, area.maxZoom)
      .map(({z, x, y}) => ({z, x, y, file: tileSource._persistPath(z, x, y)}))
      .filter((tile) => fs.existsSync(tile.file));
  }
  const tiles = [];
  let zooms = [];
  try {
    zooms = fs.readdirSync(tileSource.cacheDir).filter((name) => /^\d+$/.test(name));
  } catch (error) {
    return tiles;
  }
  for (const zoom of zooms) {
    for (const name of fs.readdirSync(path.join(tileSource.cacheDir, zoom))) {
      const m = name.match(/^(\d+)-(\d+)\.pbf$/);
      if (m) {
        tiles.push({z: +zoom, x: +m[1], y: +m[2], file: path.join(tileSource.cacheDir, zoom, name)});
      }
    }
  }
  return tiles;
}

// [west, south, east, north] of the area, or of the tiles
function boundsOf(area, tiles) {
  if (area) {
    const dLat = area.radiusKm / 111.32;
    const dLon = Math.min(180, area.radiusKm / (111.32 * Math.max(0.01, Math.cos(area.lat * Math.PI / 180))));
    return [Math.max(-180, area.lon - dLon), Math.max(-85.0511, area.lat - dLat), Math.min(180, area.lon + dLon), Math.min(85.0511, area.lat + dLat)];
  }
  const deepest = Math.max(...tiles.map((tile) => tile.z));
  const top = tiles.filter((tile) => tile.z === deepest);
  const nw = utils.tile2ll(Math.min(...top.map((t) => t.x)), Math.min(...top.map((t) => t.y)), deepest);
  const se = utils.tile2ll(Math.max(...top.map((t) => t.x)) + 1, Math.max(...top.map((t) => t.y)) + 1, deepest);
  return [nw.lon, se.lat, se.lon, nw.lat];
}

// Writes the pack; returns {tiles, bytes, minZoom, maxZoom}
function writePack(tileSource, file, area = null, onProgress = null) {
  const tiles = cachedTiles(tileSource, area);
  if (!tiles.length) {
    throw new Error(area ? 'no tiles of that area are in the disk cache - add --download to fetch them first' : 'the disk cache of this tile source is empty');
  }
  const tmp = `${file}.${process.pid}.tmp`;
  const pack = new MBTilesFile(tmp, {write: true});
  let bytes = 0;
  let written = 0;
  const zooms = new Set();
  try {
    pack.transaction(() => {
      for (const tile of tiles) {
        let data;
        try {
          data = fs.readFileSync(tile.file);
        } catch (error) {
          continue;
        }
        // only valid gzipped vector tiles go in
        if (!data.length || !tileSource.constructor.looksLikeTile(data)) {
          continue;
        }
        pack.putTile(tile.z, tile.x, tile.y, data);
        bytes += data.length;
        written++;
        zooms.add(tile.z);
        if (onProgress && written % 200 === 0) {
          onProgress(written, tiles.length);
        }
      }
      const bounds = boundsOf(area, tiles);
      const minZoom = Math.min(...zooms);
      const maxZoom = Math.max(...zooms);
      pack.putInfo({
        name: path.basename(file, '.mbtiles'),
        format: 'pbf',
        type: 'baselayer',
        description: `Map pack made with MapSCII from ${tileSource.source}`,
        minzoom: minZoom,
        maxzoom: maxZoom,
        bounds: bounds.map((v) => +v.toFixed(5)),
        center: [+((bounds[0] + bounds[2]) / 2).toFixed(5), +((bounds[1] + bounds[3]) / 2).toFixed(5), Math.min(maxZoom, 12)],
        attribution: tileSource.attribution,
        vector_layers: tileSource.vectorLayers,
        mapscii_schema: tileSource.schema,
      });
    });
    pack.close();
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      pack.close();
    } catch (closeError) {
      void 0;
    }
    fs.rmSync(tmp, {force: true});
    throw error;
  }
  return {tiles: written, bytes, minZoom: Math.min(...zooms), maxZoom: Math.max(...zooms)};
}

module.exports = {writePack, cachedTiles};
