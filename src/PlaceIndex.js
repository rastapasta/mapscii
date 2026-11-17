// An offline index of the place names in every tile read, kept in SQLite.
'use strict';
const fs = require('fs');
const path = require('path');
const MBTilesFile = require('./MBTilesFile');

// kind of label by style: [kind, rank (lower first), zoom to show it at]
const kinds = {
  country_label: ['country', 0, 5],
  state_label: ['state', 1, 7],
  place_label_city: ['city', 2, 11],
  marine_label: ['water', 3, 7],
  water_label: ['water', 3, 12],
  place_label_town: ['town', 4, 13],
  airport_label: ['airport', 5, 13],
  place_label_village: ['village', 6, 14],
  rail_station_label: ['station', 7, 15],
  place_label_other: ['place', 8, 15],
  poi_label: ['sight', 9, 16],
  road_label: ['street', 10, 16],
};

// [kind, rank, zoom] of a label, by its style
function kindOf(feature) {
  const id = feature.style && feature.style.id;
  if (id && kinds[id]) {
    return kinds[id];
  }
  if (kinds[feature.layer]) {
    return kinds[feature.layer];
  }
  return null;
}

const letters = {'ł': 'l', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'đ': 'd', 'ı': 'i', 'þ': 'th', 'ð': 'd', 'ħ': 'h'};

// lower case, without accents and punctuation
function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[łøßæœđıþðħ]/g, (c) => letters[c])
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// rows {key, name, kind, rank, zoom, lat, lon, cell}; long streets get one row about every km
function namesOf(z, x, y, tile) {
  const n = Math.pow(2, z);
  const rows = [];
  for (const [layerName, layer] of Object.entries(tile.layers || {})) {
    if (!/label/.test(layerName)) continue;
    for (const feature of layer.tree.all()) {
      const kind = kindOf(feature);
      if (!kind || !feature.label || !feature.points || !feature.points.length) continue;
      let point = feature.points[0];
      if (Array.isArray(point)) point = point[0];
      if (!point || point.x < 0 || point.y < 0 || point.x >= layer.extent || point.y >= layer.extent) continue;
      const lon = (x + point.x / layer.extent) / n * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + point.y / layer.extent) / n))) * 180 / Math.PI;
      const key = normalize(feature.label);
      if (!key) continue;
      rows.push({key, name: feature.label, kind: kind[0], rank: kind[1], zoom: kind[2], lat: +lat.toFixed(6), lon: +lon.toFixed(6), cell: `${lat.toFixed(2)},${lon.toFixed(2)}`});
    }
  }
  return rows;
}

// whole names, then prefixes, then word prefixes, then substrings; then rank, then distance
function best(rows, query, near, limit) {
  const match = (key) => key === query ? 0 : key.startsWith(query) ? 1 : (' ' + key).includes(' ' + query) ? 2 : 3;
  const distance = (row) => near ? Math.hypot(row.lat - near.lat, (row.lon - near.lon) * Math.cos(near.lat * Math.PI / 180)) : 0;
  rows.sort((a, b) => match(a.key) - match(b.key) || a.rank - b.rank || distance(a) - distance(b) || a.name.length - b.name.length);
  const results = [];
  for (const row of rows) {
    if (results.some((r) => r.name === row.name && r.kind === row.kind && Math.abs(r.lat - row.lat) < 0.05 && Math.abs(r.lon - row.lon) < 0.05)) continue;
    results.push({name: row.name, kind: row.kind, lat: row.lat, lon: row.lon, zoom: row.zoom});
    if (results.length >= limit) break;
  }
  return results;
}

class PlaceIndex {
  constructor(file) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const {DatabaseSync} = MBTilesFile.sqlite();
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA busy_timeout = 2000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS places (
        key TEXT, name TEXT, kind TEXT, rank INTEGER, zoom INTEGER, lat REAL, lon REAL, cell TEXT,
        UNIQUE (key, kind, cell)
      );
      CREATE TABLE IF NOT EXISTS tiles (tile TEXT PRIMARY KEY);
    `);
    this.insert = this.db.prepare('INSERT OR IGNORE INTO places VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    this.markTile = this.db.prepare('INSERT OR IGNORE INTO tiles VALUES (?)');
    this.hasTile = this.db.prepare('SELECT 1 FROM tiles WHERE tile = ?');
  }

  // Adds a tile's names; returns how many were new
  addTile(source, z, x, y, tile) {
    const id = `${source} ${z}/${x}/${y}`;
    if (this.hasTile.get(id)) {
      return 0;
    }
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const p of namesOf(z, x, y, tile)) {
        added += this.insert.run(p.key, p.name, p.kind, p.rank, p.zoom, p.lat, p.lon, p.cell).changes;
      }
      this.markTile.run(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return added;
  }

  // The best matches for a search: [{name, kind, lat, lon, zoom}]
  search(text, {near = null, limit = 20} = {}) {
    const query = normalize(text);
    if (!query) {
      return [];
    }
    const pattern = `%${query.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = this.db.prepare('SELECT name, key, kind, rank, zoom, lat, lon FROM places WHERE key LIKE ? ESCAPE \'\\\' LIMIT 5000').all(pattern);
    return best(rows, query, near, limit);
  }

  // Towns (or other kinds) nearest a point within maxKm, nearest first
  nearest(lat, lon, {kinds = ['city', 'town', 'village'], maxKm = 30, limit = 5} = {}) {
    const dLat = maxKm / 111.32;
    const dLon = maxKm / (111.32 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
    const rows = this.db.prepare(`SELECT name, kind, zoom, lat, lon FROM places WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? AND kind IN (${kinds.map(() => '?').join(',')})`)
      .all(lat - dLat, lat + dLat, lon - dLon, lon + dLon, ...kinds);
    const km = (row) => Math.hypot(row.lat - lat, (row.lon - lon) * Math.cos(lat * Math.PI / 180)) * 111.32;
    const seen = new Set();
    return rows.map((row) => Object.assign(row, {km: km(row)}))
      .filter((row) => row.km <= maxKm)
      .sort((a, b) => a.km - b.km)
      .filter((row) => !seen.has(row.name) && seen.add(row.name))
      .slice(0, limit);
  }

  // How many names the index has
  size() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM places').get().n;
  }

  // Closes the database
  close() {
    this.db.close();
  }
}

PlaceIndex.normalize = normalize;
PlaceIndex.namesOf = namesOf;
PlaceIndex.best = best;
module.exports = PlaceIndex;
