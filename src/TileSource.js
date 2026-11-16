/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles

  Tiles load in the background: peekTile() never blocks, requestTile() starts a
  load, and onTileLoaded says when one is ready. Every download is kept on disk.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {promisify} = require('util');
const gunzip = promisify(zlib.gunzip);
const envPaths = require('env-paths');
const paths = envPaths('mapscii');

const Tile = require('./Tile');
const config = require('./config');
const utils = require('./utils');
const OpenMapTiles = require('./OpenMapTiles');
const Net = require('./Net');

const MBTilesFile = require('./MBTilesFile');

const modes = {
  MBTiles: 1,
  VectorTile: 2,
  HTTP: 3,
};

const meter = Net.meter;

class TileSource {
  // source: a name from config.sources, a TileJSON URL, a {z}/{x}/{y} template, a base URL or an .mbtiles file
  init(source) {
    this.sourceName = config.sources[source] ? source : null;
    this.source = config.sources[source] || source;

    // parsed tiles in LRU order (a Map keeps insertion order)
    this.cache = new Map();
    this.cacheSize = config.tileCacheSize;

    this.loading = new Map();
    // failed tiles: key -> time before which they aren't retried
    this.failed = new Map();
    // key -> short reason, or null if the server has no tile there
    this.failReason = new Map();
    this.retryTimer = null;

    // what the renderer wants: key -> {generation, rank}
    this.wanted = new Map();
    // each draw starts a generation; the newest loads first
    this.generation = 0;

    this.downloads = new Map();
    this.queue = new Map();
    this.activeDownloads = 0;
    this.activePrefetches = 0;
    this.onDisk = new Set();

    this.onTileLoaded = null;

    this.mode = null;
    this.mbtiles = null;
    this.styler = null;
    this.ready = Promise.resolve();
    this.schema = config.tileSchema || 'osm2vectortiles';
    this.attribution = null;

    if (this.source.startsWith('http')) {
      this.cacheDir = this._cacheDirFor(this.source);
      if (config.persistDownloadedTiles) {
        this._initPersistence();
      }

      this.mode = modes.HTTP;
      if (this.source.includes('{z}')) {
        this.tileUrl = this.source;
      } else if (this.source.endsWith('/')) {
        this.tileUrl = this.source + '{z}/{x}/{y}.pbf';
      } else {
        this.ready = this._whenReady();
      }

    } else if (this.source.endsWith('.mbtiles')) {
      this.mode = modes.MBTiles;
      this.ready = this.loadMBTiles(source);
    } else {
      throw new Error(`unknown tile source "${source}": use ${Object.keys(config.sources).join(' or ')}, an http(s) URL or an .mbtiles file`);
    }
    return this.ready;
  }

  // the default source's tiles live in the cache folder itself, others in their own folders
  _cacheDirFor(source) {
    if (source === 'https://mapscii.me/' || source === 'http://mapscii.me/') {
      return paths.cache;
    }
    const name = this.sourceName || source.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]+/g, '_');
    return path.join(paths.cache, name);
  }

  // Reads the TileJSON. A cached copy is used at once while a fresh one is fetched in the background.
  async _loadTileJSON(url) {
    const copy = path.join(this.cacheDir, 'tilejson.json');
    let saved = null;
    try {
      saved = JSON.parse(fs.readFileSync(copy, 'utf8'));
      this._useTileJSON(saved, url);
    } catch (error) {
      saved = null;
    }

    const fresh = this._fetch(url).then((buffer) => {
      const tilejson = JSON.parse(buffer.toString('utf8'));
      this._useTileJSON(tilejson, url);
      if (config.persistDownloadedTiles) {
        this._createFolder(this.cacheDir);
        fs.writeFile(copy, JSON.stringify(tilejson), () => null);
      }
    });

    if (saved) {
      fresh.catch(() => null);
      return;
    }
    try {
      await fresh;
    } catch (error) {
      const host = url.replace(/^\w+:\/\//, '').split('/')[0];
      throw new Error(`could not reach ${host}: ${failureReason(error) || error.message}`);
    }
  }

  // Takes the tile URL, zoom range, schema and attribution from a TileJSON
  _useTileJSON(tilejson, url) {
    if (!tilejson.tiles || !tilejson.tiles.length) {
      throw new Error(`${url} lists no tiles`);
    }
    this.tileUrl = tilejson.tiles[0];
    this.vectorLayers = tilejson.vector_layers;
    if (!config.tileSchema && OpenMapTiles.matches(tilejson.vector_layers)) {
      this.schema = 'openmaptiles';
    } else if (!config.tileSchema && tilejson.mapscii_schema) {
      // another MapSCII sharing its tiles says it
      this.schema = tilejson.mapscii_schema;
    }
    if (tilejson.maxzoom !== undefined) {
      config.tileRange = Math.min(config.tileRange, tilejson.maxzoom);
    }
    if (tilejson.attribution) {
      this.attribution = plainText(tilejson.attribution);
    }
  }

  // Uses an MBTiles file as the source
  loadMBTiles(source) {
    this.mbtiles = new MBTilesFile(source);
    const info = this.mbtiles.getInfo();
    // the metadata's layers tell the schema; MapSCII's packs state it
    if (!config.tileSchema) {
      if (info.mapscii_schema) {
        this.schema = info.mapscii_schema;
      } else if (OpenMapTiles.matches(info.vector_layers)) {
        this.schema = 'openmaptiles';
      }
    }
    if (info.attribution) {
      this.attribution = plainText(info.attribution);
    }
    // deeper zooms magnify the deepest tiles in the file
    if (info.maxzoom !== undefined && Number.isFinite(info.maxzoom)) {
      config.tileRange = Math.min(config.tileRange, info.maxzoom);
    }
    this.packInfo = info;
    return Promise.resolve();
  }

  // The style, for indexing names by kind
  useStyler(styler) {
    this.styler = styler;
  }

  // Names of tiles read go into this place index (null: none)
  useIndex(placeIndex) {
    this.placeIndex = placeIndex;
    this.indexQueue = [];
  }

  // indexed one tile at a time, a little later: each takes up to ~10 ms
  _indexLater(z, x, y, tile) {
    if (!this.placeIndex) {
      return;
    }
    this.indexQueue.push([z, x, y, tile]);
    if (this.indexQueue.length > 50) {
      this.indexQueue.shift();
    }
    if (!this.indexTimer) {
      this._indexNext();
    }
  }

  // Indexes the next queued tile's names a little later
  _indexNext() {
    this.indexTimer = setTimeout(() => {
      this.indexTimer = null;
      const item = this.indexQueue.shift();
      if (!item || !this.placeIndex) {
        return;
      }
      try {
        this.placeIndex.addTile(this.source, ...item);
      } catch (error) {
        // e.g. a read-only disk
        this.placeIndex = null;
        return;
      }
      if (this.indexQueue.length) {
        this._indexNext();
      }
    }, config.indexDelay);
    if (this.indexTimer.unref) {
      this.indexTimer.unref();
    }
  }

  // The deepest zoom level the source has tiles for
  maxZoom() {
    return config.tileRange;
  }

  // Unzipped tile data for TileServer: from the pack or cache, else downloaded if download is set.
  // Rejects with error.status 404 if there is no such tile, error.notCached if it mustn't be downloaded.
  async getTileData(z, x, y, {download = true} = {}) {
    await this._whenReady();
    if (this.mode === modes.MBTiles) {
      const data = await unzipTile(await this._getMBTile(z, x, y));
      if (!data) {
        throw Object.assign(new Error(`tile ${z}/${x}/${y} in ${this.source} is damaged`), {corrupt: true});
      }
      return data;
    }
    if (config.persistDownloadedTiles) {
      const cached = await this._getPersisted(z, x, y);
      if (cached) {
        return cached;
      }
    }
    if (!download) {
      throw Object.assign(new Error(`tile ${z}/${x}/${y} is not in the disk cache`), {notCached: true});
    }
    return this._enqueueDownload(z, x, y, false);
  }

  // The parsed tile if it is in memory, else null; never blocks
  peekTile(z, x, y) {
    const key = this._key(z, x, y);
    const tile = this.cache.get(key);
    if (tile) {
      this.cache.delete(key);
      this.cache.set(key, tile);
      tile.usedIn = this.generation;
      return tile;
    }
    return null;
  }

  // Starts a frame: tiles requested from now on are the most urgent
  beginFrame() {
    this.generation++;
  }

  // Tiles of the latest frame load first, lowest rank first.
  requestTile(z, x, y, rank = 0) {
    const key = this._key(z, x, y);
    if (this.cache.has(key)) {
      return;
    }
    this.wanted.set(key, {generation: this.generation, rank});
    const queued = this.queue.get(key);
    if (queued) {
      queued.generation = this.generation;
      queued.rank = rank;
      queued.prefetch = false;
    }
    if (this.loading.has(key)) {
      return;
    }
    if ((this.failed.get(key) || 0) > Date.now()) {
      return;
    }
    this.getTile(z, x, y).catch(() => null);
  }

  // Prefetch into the disk cache, without parsing, when no visible tile is waiting.
  prefetchTile(z, x, y, rank = 0) {
    if (this.mode !== modes.HTTP || !config.persistDownloadedTiles) {
      return;
    }
    const key = this._key(z, x, y);
    if (this.cache.has(key) || this.loading.has(key) || this.downloads.has(key) || this.onDisk.has(key)) {
      return;
    }
    if ((this.failed.get(key) || 0) > Date.now()) {
      return;
    }
    // a damaged cached file is deleted and downloaded again
    this._getPersisted(z, x, y).then((buffer) => {
      if (buffer) {
        this.onDisk.add(key);
        return;
      }
      this.wanted.set(key, {generation: this.generation, rank});
      this._enqueueDownload(z, x, y, true).then(() => {
        this._forgetPrefetch(key);
      }, (error) => {
        this._forgetPrefetch(key);
        if (!error.cancelled) {
          this.failed.set(key, Date.now() + config.tileRetryDelay);
        }
      });
    });
  }

  // Whether a tile is loading
  isLoading(z, x, y) {
    return this.loading.has(this._key(z, x, y));
  }

  // Whether the source has no tile there (a 404)
  isEmpty(z, x, y) {
    const key = this._key(z, x, y);
    return this.failReason.has(key) && this.failReason.get(key) === null;
  }

  // Why the tile couldn't be loaded last time, or null
  failureOf(z, x, y) {
    return this.failReason.get(this._key(z, x, y)) || null;
  }

  // Ensures a draw after config.tileRetryDelay, so the map fills in once the network is back.
  _scheduleRetry() {
    if (this.retryTimer) {
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._notify(null);
    }, config.tileRetryDelay + 100);
    if (this.retryTimer.unref) {
      this.retryTimer.unref();
    }
  }

  // Forgets a prefetch nobody wants any more
  _forgetPrefetch(key) {
    if (!this.loading.has(key)) {
      this.wanted.delete(key);
    }
  }

  // A promise of the parsed tile, loading it if needed
  getTile(z, x, y) {
    if (!this.mode) {
      throw new Error('no TileSource defined');
    }

    const key = this._key(z, x, y);
    const cached = this.peekTile(z, x, y);
    if (cached) {
      return Promise.resolve(cached);
    }
    if (this.loading.has(key)) {
      return this.loading.get(key);
    }

    // cached tiles also wait for the TileJSON, which says how to read them
    let promise = this._whenReady().then(() => {
      switch (this.mode) {
        case modes.MBTiles:
          return this._getMBTile(z, x, y);
        case modes.HTTP:
          return this._getHTTP(z, x, y);
      }
    });

    promise = promise.then((buffer) => {
      return new Tile(this.styler, this.schema).load(buffer).catch((error) => {
        error.corrupt = true;
        throw error;
      });
    }).then((tile) => {
      this.loading.delete(key);
      this.wanted.delete(key);
      this.failed.delete(key);
      this.failReason.delete(key);
      this._addToCache(key, tile);
      this._notify(key);
      this._indexLater(z, x, y, tile);
      return tile;
    }, (error) => {
      this.loading.delete(key);
      this.wanted.delete(key);
      if (!error.cancelled) {
        // a file doesn't change: what isn't in it never will be
        const final = this.mode === modes.MBTiles;
        this.failed.set(key, final ? Infinity : Date.now() + config.tileRetryDelay);
        this.failReason.set(key, failureReason(error));
        if (!final) {
          this._scheduleRetry();
        }
        if (error.corrupt && this.mode === modes.HTTP && config.persistDownloadedTiles) {
          this.onDisk.delete(key);
          fs.unlink(this._persistPath(z, x, y), () => null);
        }
      }
      this._notify(key);
      throw error;
    });

    this.loading.set(key, promise);
    return promise;
  }

  // [{z, x, y}] within radiusKm, zoom 0 to maxZoom, across the date line too
  areaTiles(lat, lon, radiusKm, maxZoom) {
    const tiles = [];
    for (const {z, left, right, top, bottom} of areaRanges(lat, lon, radiusKm, maxZoom)) {
      const gridSize = Math.pow(2, z);
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          tiles.push({z, x: ((x % gridSize) + gridSize) % gridSize, y});
        }
      }
    }
    return tiles;
  }

  // How many tiles areaTiles would list, without listing them
  countAreaTiles(lat, lon, radiusKm, maxZoom) {
    return areaRanges(lat, lon, radiusKm, maxZoom)
      .reduce((sum, r) => sum + (r.right - r.left + 1) * Math.max(0, r.bottom - r.top + 1), 0);
  }

  // Refuses areas that wouldn't fit on the disk; stops starting tiles when shouldStop() says so.
  async downloadArea(lat, lon, radiusKm, maxZoom, onProgress, {shouldStop = null} = {}) {
    if (this.mode !== modes.HTTP || !config.persistDownloadedTiles) {
      throw new Error('downloading an area needs a HTTP tile source and persistDownloadedTiles');
    }
    const count = this.countAreaTiles(lat, lon, radiusKm, maxZoom);
    const neededMB = Math.ceil(count * config.downloadTileKB / 1024);
    const smaller = 'choose a smaller radius or a lower --download_max_zoom';
    if (count > config.maxDownloadTiles) {
      throw new Error(`Too big: ${count} tiles (about ${neededMB} MB), at most ${config.maxDownloadTiles} at a time - ${smaller}`);
    }
    this._createFolder(this.cacheDir);
    const freeMB = freeSpaceMB(this.cacheDir);
    if (freeMB !== null && neededMB > freeMB) {
      throw new Error(`Too big: about ${neededMB} MB, but only ${freeMB} MB are free on the disk - ${smaller}`);
    }
    const tiles = this.areaTiles(lat, lon, radiusKm, maxZoom);

    let done = 0;
    let failed = 0;
    let next = 0;
    let stopped = false;
    // a few at a time keeps open files and memory bounded for big areas
    const worker = async () => {
      while (next < tiles.length) {
        if (shouldStop && shouldStop()) {
          stopped = true;
          return;
        }
        const {z, x, y} = tiles[next++];
        try {
          if (!await this._getPersisted(z, x, y)) {
            await this._enqueueDownload(z, x, y, false);
          }
        } catch (error) {
          failed++;
        }
        done++;
        if (onProgress) {
          onProgress(done, tiles.length, failed);
        }
      }
    };
    await Promise.all(Array.from({length: 16}, worker));
    await this.flushWrites();
    return {total: tiles.length, failed, done, stopped};
  }

  // Resolves once the TileJSON or MBTiles file is read; a failed TileJSON is retried after tileRetryDelay.
  _whenReady() {
    if (this.mode !== modes.HTTP) {
      return this.ready;
    }
    if (this.tileUrl) {
      return Promise.resolve();
    }
    if (!this.tileJSONLoading) {
      this.tileJSONLoading = this._loadTileJSON(this.source).then(() => {
        if (this.sourceFailed) {
          this.sourceFailed = false;
          this.failed.clear();
          this._notify(null);
        }
      }, (error) => {
        this.sourceFailed = true;
        clearTimeout(this.tileJSONRetry);
        this.tileJSONRetry = setTimeout(() => {
          this.tileJSONLoading = null;
          this._whenReady().catch(() => null);
        }, config.tileRetryDelay);
        if (this.tileJSONRetry.unref) {
          this.tileJSONRetry.unref();
        }
        throw error;
      });
    }
    return this.tileJSONLoading;
  }

  // Tells the renderer a tile is ready
  _notify(key) {
    if (this.onTileLoaded) {
      this.onTileLoaded(key);
    }
  }

  // The cache key of a tile
  _key(z, x, y) {
    return z + '-' + x + '-' + y;
  }

  // Keeps a parsed tile in memory, dropping the least recently used beyond the budget
  _addToCache(key, tile) {
    const old = this.cache.get(key);
    if (old) {
      this.cacheBytes -= old.memoryEstimate || 0;
    }
    this.cache.delete(key);
    this.cache.set(key, tile);
    this.cacheBytes = (this.cacheBytes || 0) + (tile.memoryEstimate || 0);
    const budget = config.tileCacheMB * 1024 * 1024;
    // the world tile and the latest frame's tiles stay
    const world = this._key(0, 0, 0);
    const keep = (oldKey) => oldKey === world || oldKey === key || this.cache.get(oldKey).usedIn >= this.generation - 1;
    while (this.cache.size > this.cacheSize || this.cacheBytes > budget) {
      let evicted = false;
      for (const oldest of this.cache.keys()) {
        if (!keep(oldest)) {
          this.cacheBytes -= this.cache.get(oldest).memoryEstimate || 0;
          this.cache.delete(oldest);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        break;
      }
    }
  }

  // A tile's data from the disk cache, else downloaded
  async _getHTTP(z, x, y) {
    if (config.persistDownloadedTiles) {
      const persistedTile = await this._getPersisted(z, x, y);
      if (persistedTile) {
        return persistedTile;
      }
    }
    return this._enqueueDownload(z, x, y, false);
  }

  // Queues a download, or joins the one already queued or running
  _enqueueDownload(z, x, y, prefetch) {
    const key = this._key(z, x, y);
    if (this.downloads.has(key)) {
      return this.downloads.get(key);
    }
    const wanted = this.wanted.get(key) || {generation: this.generation, rank: 0};
    const promise = new Promise((resolve, reject) => {
      this.queue.set(key, {
        z, x, y,
        generation: wanted.generation,
        rank: wanted.rank,
        prefetch,
        resolve,
        reject,
      });
    });
    this.downloads.set(key, promise);
    const forget = () => this.downloads.delete(key);
    promise.then(forget, forget);
    this._trimQueue();
    this._pumpQueue();
    return promise;
  }

  // Whether a should be downloaded before b
  _moreUrgent(a, b) {
    if (a.prefetch !== b.prefetch) {
      return !a.prefetch;
    }
    if (a.generation !== b.generation) {
      return a.generation > b.generation;
    }
    return a.rank < b.rank;
  }

  // Starts queued downloads while connections are free
  _pumpQueue() {
    while (this.queue.size) {
      let next = null;
      for (const [key, item] of this.queue) {
        if (!next || this._moreUrgent(item, next.item)) {
          next = {key, item};
        }
      }
      // visible tiles get their own connections; prefetching only uses a few extra ones
      const busy = next.item.prefetch ?
        this.activePrefetches >= config.maxConcurrentPrefetches ||
          this.activeDownloads + this.activePrefetches >= config.maxConnections :
        this.activeDownloads >= config.maxConcurrentDownloads;
      if (busy) {
        return;
      }
      this.queue.delete(next.key);

      const {item} = next;
      if (item.prefetch) {
        this.activePrefetches++;
      } else {
        this.activeDownloads++;
      }
      this._download(item.z, item.x, item.y).then(async (buffer) => {
        // e.g. a Wi-Fi login page instead of a tile
        const data = await unzipTile(buffer);
        if (!data) {
          const error = new Error('the server sent something else than a map tile');
          error.corrupt = true;
          throw error;
        }
        if (config.persistDownloadedTiles) {
          this._persistTile(item.z, item.x, item.y, buffer);
        }
        return data;
      }).then(item.resolve, item.reject).then(() => {
        if (item.prefetch) {
          this.activePrefetches--;
        } else {
          this.activeDownloads--;
        }
        this._pumpQueue();
      });
    }
  }

  // Drops the least urgent queued downloads: the view has moved on from them
  _trimQueue() {
    while (this.queue.size > config.maxQueuedDownloads) {
      let last = null;
      for (const [key, item] of this.queue) {
        if (!last || this._moreUrgent(last.item, item)) {
          last = {key, item};
        }
      }
      this.queue.delete(last.key);
      const error = new Error('tile download cancelled');
      error.cancelled = true;
      last.item.reject(error);
    }
  }

  // Downloads a tile once the source is known
  async _download(z, x, y) {
    await this._whenReady();
    return this._fetch(this.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }

  // Fetches a URL into a Buffer
  _fetch(url) {
    return Net.fetchBuffer(url);
  }

  // a tile missing from the file counts as a 404, so a coarser one stands in
  _getMBTile(z, x, y) {
    const data = this.mbtiles.getTile(z, x, y);
    if (!data) {
      const error = new Error(`tile ${z}/${x}/${y} is not in ${this.source}`);
      error.status = 404;
      return Promise.reject(error);
    }
    return Promise.resolve(data);
  }

  // Creates the cache folder
  _initPersistence() {
    try {
      this._createFolder(this.cacheDir);
    } catch (error) {
      config.persistDownloadedTiles = false;
    }
  }

  // Stores a downloaded tile in the background; see flushWrites
  _persistTile(z, x, y, buffer) {
    const write = this._writeTile(z, x, y, buffer).catch(() => null);
    this.pendingWrites = this.pendingWrites || new Set();
    this.pendingWrites.add(write);
    write.then(() => this.pendingWrites.delete(write));
    return write;
  }

  // Resolves when all tiles downloaded so far are on the disk
  flushWrites() {
    return Promise.all([...(this.pendingWrites || [])]);
  }

  // Writes a tile to the disk cache, gzipped
  async _writeTile(z, x, y, buffer) {
    // stored gzipped (about a third of the space), even if the server sent it unzipped
    if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
      buffer = await promisify(zlib.gzip)(buffer);
    }
    this._createFolder(path.join(this.cacheDir, z.toString()));
    const filePath = this._persistPath(z, x, y);
    // via a temporary file, so an interrupted write never leaves a broken tile
    const tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    try {
      await fs.promises.writeFile(tmpPath, buffer);
      await fs.promises.rename(tmpPath, filePath);
      this.onDisk.add(this._key(z, x, y));
    } catch (error) {
      await fs.promises.unlink(tmpPath).catch(() => null);
    }
  }

  // A damaged file (cut short, or not a tile) is deleted so it downloads again; an empty file counts as damaged.
  async _getPersisted(z, x, y) {
    const file = this._persistPath(z, x, y);
    let buffer;
    try {
      buffer = await fs.promises.readFile(file);
    } catch (error) {
      return false;
    }
    const data = buffer.length ? await unzipTile(buffer) : null;
    if (!data) {
      this.onDisk.delete(this._key(z, x, y));
      fs.unlink(file, () => null);
      return false;
    }
    return data;
  }

  // The cache file of a tile
  _persistPath(z, x, y) {
    return path.join(this.cacheDir, z.toString(), `${x}-${y}.pbf`);
  }

  // Creates a folder; returns true
  _createFolder(path) {
    try {
      fs.mkdirSync(path, {recursive: true});
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return true;
      throw error;
    }
  }
}

// [{z, left, right, top, bottom}] per zoom; left and right may lie beyond the date line
function areaRanges(lat, lon, radiusKm, maxZoom) {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.01, Math.cos(lat * Math.PI / 180)));
  const ranges = [];
  for (let z = 0; z <= maxZoom; z++) {
    const gridSize = Math.pow(2, z);
    let left = Math.floor(utils.ll2tile(lon - dLon, lat, z).x);
    let right = Math.floor(utils.ll2tile(lon + dLon, lat, z).x);
    if (right - left + 1 >= gridSize) {
      left = 0;
      right = gridSize - 1;
    }
    const top = Math.max(0, Math.floor(utils.ll2tile(lon, Math.min(85.0511, lat + dLat), z).y));
    const bottom = Math.min(gridSize - 1, Math.floor(utils.ll2tile(lon, Math.max(-85.0511, lat - dLat), z).y));
    ranges.push({z, left, right, top, bottom});
  }
  return ranges;
}

// MB free on the disk holding the folder, or null if unknown
function freeSpaceMB(folder) {
  try {
    const stats = fs.statfsSync(folder);
    return Math.floor(stats.bavail * stats.bsize / 1024 / 1024);
  } catch (error) {
    return null;
  }
}

// the attribution as one line of plain text, without control characters
function plainText(html) {
  const entities = {'&copy;': '©', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' '};
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&(copy|amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity])
    // eslint-disable-next-line no-control-regex
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim();
}

// Whether data starts with the gzip header
function isGzipped(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

// unzipped off the main thread, or null if it isn't a vector tile (e.g. an error page)
async function unzipTile(buffer) {
  let data = buffer;
  if (isGzipped(data)) {
    try {
      data = await gunzip(data);
    } catch (error) {
      return null;
    }
  }
  return hasTileShape(data) ? data : null;
}

// Whether data has the shape of a vector tile, so error pages are turned away
function looksLikeTile(buffer) {
  let data = buffer;
  if (isGzipped(data)) {
    try {
      data = zlib.gunzipSync(data);
    } catch (error) {
      return false;
    }
  }
  return hasTileShape(data);
}

// A cheap check that data is a vector tile: layers (protobuf field 3) ending exactly at the end.
function hasTileShape(data) {
  let pos = 0;
  while (pos < data.length) {
    if (data[pos++] !== 0x1a) {
      return false;
    }
    let length = 0;
    let shift = 0;
    let byte;
    do {
      if (pos >= data.length || shift > 28) {
        return false;
      }
      byte = data[pos++];
      length += (byte & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (byte & 0x80);
    pos += length;
  }
  return pos === data.length;
}

// null when the server simply has no tile there
function failureReason(error) {
  if (error.status === 404) {
    return null;
  }
  if (error.status) {
    return `server error ${error.status}`;
  }
  if (error.corrupt) {
    return error.message.includes('something else') ? 'the server sent no map tile' : 'damaged tile';
  }
  if (error.type === 'request-timeout') {
    return 'the tile server stopped sending';
  }
  if (error.type === 'system') {
    return 'no connection to the tile server';
  }
  return error.message.slice(0, 60);
}

TileSource.looksLikeTile = looksLikeTile;
TileSource.meter = meter;
TileSource.paths = paths;
TileSource.plainText = plainText;
module.exports = TileSource;
