// TileSource for the browser: fetch and Cache Storage instead of the network stack and disk.
'use strict';
const Tile = require('../../src/Tile');
const Net = require('../../src/Net');
const {gunzipBytes} = require('./shims/zlib');

const CACHE = 'map-tiles-v1';
const MAX_DOWNLOADS = 6;
const RETRY_AFTER = 10000;
// tiles kept in Cache Storage, about 100-300 MB
const MAX_STORED = 3000;

class AppTileSource {
  // options: {tilejson, schema, maxTiles, memoryMB (a dense city tile takes ~20 MB)}
  constructor({tilejson, schema = null, maxTiles = 160, memoryMB = 120} = {}) {
    this.tilejsonUrl = tilejson;
    this.schema = schema;
    this.maxTiles = maxTiles;
    this.memoryBudget = memoryMB * 1024 * 1024;
    this.memoryUsed = 0;
    this.cache = new Map();
    this.loading = new Map();
    this.failed = new Map();
    this.failReason = new Map();
    this.lastError = new Map();
    this.queue = [];
    this.downloads = 0;
    this.generation = 0;
    this.onTileLoaded = () => null;
    this.attribution = '';
    this.maxzoom = 14;
  }

  // Reads the TileJSON, or its saved copy offline
  async init() {
    let tilejson;
    try {
      tilejson = await Net.fetchJson(this.tilejsonUrl);
      saveCopy(this.tilejsonUrl, JSON.stringify(tilejson));
    } catch (error) {
      const copy = await loadCopy(this.tilejsonUrl);
      if (!copy) throw new Error(`can't reach the map server (${new URL(this.tilejsonUrl, location.href).host}), and no map was saved yet`);
      tilejson = JSON.parse(copy);
    }
    // only the part before {z} goes through URL, which would encode the braces
    const template = tilejson.tiles[0];
    const cut = template.indexOf('{');
    this.template = new URL(template.slice(0, cut), new URL(this.tilejsonUrl, location.href)).href + template.slice(cut);
    this.maxzoom = tilejson.maxzoom || 14;
    if (!this.schema) {
      this.schema = (tilejson.vector_layers || []).some((l) => l.id === 'transportation') ? 'openmaptiles' : 'osm2vectortiles';
    }
    this.attribution = String(tilejson.attribution || '').replace(/<[^>]*>/g, '').replace(/&copy;/g, '©').replace(/\s+/g, ' ').trim();
  }

  // The style, for indexing names by kind
  useStyler(styler) {
    this.styler = styler;
  }

  // The deepest zoom level the source has tiles for
  maxZoom() {
    return this.maxzoom;
  }

  // The cache key of a tile
  _key(z, x, y) {
    return `${z}/${x}/${y}`;
  }

  // The parsed tile if it is in memory, else null
  peekTile(z, x, y) {
    const key = this._key(z, x, y);
    const tile = this.cache.get(key);
    if (!tile) return null;
    this.cache.delete(key);
    this.cache.set(key, tile);
    return tile;
  }

  // Starts a frame: older requests may be dropped
  beginFrame() {
    this.generation++;
  }

  // Starts loading a tile for this frame
  requestTile(z, x, y, rank = 0) {
    const key = this._key(z, x, y);
    if (this.cache.has(key)) return;
    const queued = this.queue.find((q) => q.key === key);
    if (queued) {
      queued.generation = this.generation;
      queued.rank = rank;
    }
    if (this.loading.has(key) || (this.failed.get(key) || 0) > Date.now()) return;
    this.getTile(z, x, y, rank, true).catch(() => null);
  }

  // no prefetching: on a phone only what is looked at should cost data
  prefetchTile() {}

  // Whether a tile is loading
  isLoading(z, x, y) {
    return this.loading.has(this._key(z, x, y));
  }

  // Why the tile couldn't be loaded, or null
  failureOf(z, x, y) {
    return this.failReason.get(this._key(z, x, y)) || null;
  }

  // Whether the source has no tile there (a 404)
  isEmpty(z, x, y) {
    const key = this._key(z, x, y);
    return this.failReason.has(key) && this.failReason.get(key) === null;
  }

  // How many tiles are loading
  pending() {
    return this.loading.size;
  }

  // droppable: a frame's request, dropped before downloading if later frames don't ask again
  getTile(z, x, y, rank = 0, droppable = false) {
    const key = this._key(z, x, y);
    const cached = this.peekTile(z, x, y);
    if (cached) return Promise.resolve(cached);
    if (this.loading.has(key)) return this.loading.get(key);
    // failed lately: answer the same until the retry time, or it would redraw for ever
    if ((this.failed.get(key) || 0) > Date.now()) return Promise.reject(this.lastError.get(key));
    let url = null;
    const promise = this._bytes(z, x, y, key, rank, droppable)
      .then(([bytes, from]) => {
        url = from;
        return new Tile(this.styler, this.schema).load(bytes).catch((error) => {
          // a damaged tile mustn't stay cached
          forget(url);
          throw Object.assign(error, {corrupt: true});
        });
      })
      .then((tile) => {
        this.loading.delete(key);
        this.failed.delete(key);
        this.failReason.delete(key);
        this._keep(key, tile);
        if (this.onTileParsed) this.onTileParsed(z, x, y, tile);
        this.onTileLoaded(key);
        return tile;
      }, (error) => {
        this.loading.delete(key);
        // dropped, not failed: asked for again, it loads
        if (error.dropped) throw error;
        this.failed.set(key, Date.now() + RETRY_AFTER);
        this.lastError.set(key, error);
        this.failReason.set(key, error.status === 404 ? null : error.type === 'system' ? 'no connection' : 'could not load');
        this.onTileLoaded(key);
        if (error.status !== 404) setTimeout(() => this.onTileLoaded(null), RETRY_AFTER + 100);
        throw error;
      });
    this.loading.set(key, promise);
    return promise;
  }

  // Keeps a parsed tile in memory, dropping the oldest beyond the budget
  _keep(key, tile) {
    const old = this.cache.get(key);
    if (old) this.memoryUsed -= old.memoryEstimate || 0;
    this.cache.delete(key);
    this.cache.set(key, tile);
    this.memoryUsed += tile.memoryEstimate || 0;
    while (this.cache.size > 1 && (this.cache.size > this.maxTiles || this.memoryUsed > this.memoryBudget)) {
      const [oldest, gone] = this.cache.entries().next().value;
      this.cache.delete(oldest);
      this.memoryUsed -= gone.memoryEstimate || 0;
    }
  }

  // A tile's bytes and URL: from Cache Storage, else downloaded and stored
  async _bytes(z, x, y, key, rank, droppable) {
    const url = this.template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    let bytes = await cached(url);
    if (!bytes) {
      await this._slot(key, rank, droppable);
      try {
        bytes = await Net.fetchBuffer(url);
      } finally {
        this.downloads--;
        this._next();
      }
      store(url, bytes);
    }
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzipBytes(bytes);
    return [bytes, url];
  }

  // Waits for a free download slot; rejects if the request is dropped
  _slot(key, rank, droppable) {
    if (this.downloads < MAX_DOWNLOADS) {
      this.downloads++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.queue.push({key, rank, generation: this.generation, droppable, resolve, reject}));
  }

  // Starts the next queued download
  _next() {
    // queued tiles no frame asked for in the last two are dropped before they cost data
    this.queue = this.queue.filter((q) => {
      if (!q.droppable || q.generation >= this.generation - 1) return true;
      q.reject(Object.assign(new Error('not needed any more'), {dropped: true}));
      return false;
    });
    if (!this.queue.length || this.downloads >= MAX_DOWNLOADS) return;
    this.queue.sort((a, b) => b.generation - a.generation || a.rank - b.rank);
    const next = this.queue.shift();
    this.downloads++;
    next.resolve();
  }
}

// absent in some private windows: then nothing is kept
async function cached(url) {
  try {
    const res = await (await caches.open(CACHE)).match(url);
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch (error) {
    return null;
  }
}

let stores = 0;
// Stores a tile in Cache Storage, trimming it now and then
async function store(url, bytes) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(url, new Response(bytes));
    if (++stores % 100 === 0) {
      const keys = await cache.keys();
      for (const request of keys.slice(0, Math.max(0, keys.length - MAX_STORED))) await cache.delete(request);
    }
  } catch (error) {
    void 0;
  }
}

// Removes a damaged tile from Cache Storage
async function forget(url) {
  try {
    await (await caches.open(CACHE)).delete(url);
  } catch (error) {
    void 0;
  }
}

// Saves a copy of a text, e.g. the TileJSON
function saveCopy(url, text) {
  try {
    localStorage.setItem(`copy:${url}`, text);
  } catch (error) {
    void 0;
  }
}

// The saved copy of a text, or null
async function loadCopy(url) {
  try {
    return localStorage.getItem(`copy:${url}`);
  } catch (error) {
    return null;
  }
}

AppTileSource.CACHE = CACHE;
module.exports = AppTileSource;
