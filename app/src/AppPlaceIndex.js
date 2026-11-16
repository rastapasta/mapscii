// The place index on the phone: PlaceIndex's names and ranking, kept in IndexedDB and searched in memory.
'use strict';
const PlaceIndex = require('../../src/PlaceIndex');

const DB = 'map-places';
const STORE = 'places';
// beyond this many names the oldest go
const MAX = 300000;

class AppPlaceIndex {
  constructor() {
    this.rows = new Map();
    this.tiles = new Set();
    this.pending = [];
    this.gone = [];
    this.db = null;
  }

  // Loads the names kept in IndexedDB
  async open() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, {keyPath: 'id'});
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const all = await new Promise((resolve, reject) => {
        const req = this.db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const row of all) this.rows.set(row.id, row);
      // save names read before the database was open
      if (this.pending.length) this._saveSoon();
    } catch (error) {
      // no IndexedDB (some private windows): names for this visit only
      this.db = null;
    }
    return this;
  }

  // Adds the names of a tile just read; returns how many were new
  addTile(z, x, y, tile) {
    const id = `${z}/${x}/${y}`;
    if (this.tiles.has(id)) return 0;
    this.tiles.add(id);
    let added = 0;
    for (const row of PlaceIndex.namesOf(z, x, y, tile)) {
      row.id = `${row.key}|${row.kind}|${row.cell}`;
      if (this.rows.has(row.id)) continue;
      this.rows.set(row.id, row);
      this.pending.push(row);
      added++;
    }
    while (this.rows.size > MAX) {
      const oldest = this.rows.keys().next().value;
      this.rows.delete(oldest);
      this.gone.push(oldest);
    }
    if (added || this.gone.length) this._saveSoon();
    return added;
  }

  // As PlaceIndex.search: [{name, kind, lat, lon, zoom}]
  search(text, {near = null, limit = 20} = {}) {
    const query = PlaceIndex.normalize(text);
    if (!query) return [];
    const rows = [];
    for (const row of this.rows.values()) {
      if (row.key.includes(query)) {
        rows.push(row);
        if (rows.length >= 5000) break;
      }
    }
    return PlaceIndex.best(rows, query, near, limit);
  }

  // How many names the index has
  size() {
    return this.rows.size;
  }

  // Saves new names to IndexedDB a little later, in one go
  _saveSoon() {
    if (!this.db || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const rows = this.pending.splice(0);
      const gone = this.gone.splice(0);
      try {
        const store = this.db.transaction(STORE, 'readwrite').objectStore(STORE);
        for (const row of rows) store.put(row);
        for (const id of gone) store.delete(id);
      } catch (error) {
        void 0;
      }
    }, 2000);
  }
}

module.exports = AppPlaceIndex;
