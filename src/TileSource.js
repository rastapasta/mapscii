/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles

  Tiles are loaded in the background: the renderer asks for what it needs with
  peekTile() (never blocks) and requestTile() (starts a load), and gets told via
  onTileLoaded once a tile is ready to be drawn. Tiles around the view can be
  downloaded ahead of time with prefetchTile(); every download is kept on disk.
*/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const {promisify} = require('util');
const gunzip = promisify(zlib.gunzip);
const http = require('http');
const https = require('https');
const fetch = require('node-fetch');
const envPaths = require('env-paths');
const paths = envPaths('mapscii');

const Tile = require('./Tile');
const config = require('./config');
const utils = require('./utils');
const OpenMapTiles = require('./OpenMapTiles');

// https://github.com/mapbox/node-mbtiles has native build dependencies (sqlite3)
// To maximize MapSCII’s compatibility, MBTiles support must be manually added via
// $> npm install -g @mapbox/mbtiles        (if MapSCII is installed with npm -g)
// $> npm install --no-save @mapbox/mbtiles (in the MapSCII folder, e.g. a git clone)
let MBTiles = null;
try {
  MBTiles = require('@mapbox/mbtiles');
} catch (err) {void 0;}

const modes = {
  MBTiles: 1,
  VectorTile: 2,
  HTTP: 3,
};

// Reuse connections instead of doing a TCP + TLS handshake for every tile.
// Node tries a host's addresses one after another and by default gives each only
// 250ms to connect - too little for slow links, where every attempt would fail
// for hosts with several addresses (like CDNs).
const agentOptions = {
  keepAlive: true,
  maxSockets: config.maxConnections,
  autoSelectFamilyAttemptTimeout: config.connectAttemptTimeout,
};
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

class TileSource {
  // source: a name from config.sources (e.g. 'openfreemap'), a TileJSON URL, a tile
  // URL template with {z}/{x}/{y}, a base URL ending in '/', or an .mbtiles file
  init(source) {
    this.sourceName = config.sources[source] ? source : null;
    this.source = config.sources[source] || source;

    // parsed tiles, kept in least-recently-used order (Map keeps insertion order)
    this.cache = new Map();
    this.cacheSize = config.tileCacheSize;

    // tiles currently being loaded: key -> Promise
    this.loading = new Map();
    // tiles which failed to load: key -> timestamp before which we don't retry
    this.failed = new Map();
    // why they failed: key -> short reason, or null if the server has no tile there
    this.failReason = new Map();
    this.retryTimer = null;

    // what the renderer currently wants: key -> {generation, rank}
    this.wanted = new Map();
    // every draw starts a new generation - tiles of the newest one load first
    this.generation = 0;

    // downloads which are queued or running: key -> Promise of the tile's data
    this.downloads = new Map();
    // network queue: key -> {z, x, y, generation, rank, prefetch, resolve, reject}
    this.queue = new Map();
    this.activeDownloads = 0;
    this.activePrefetches = 0;
    // tiles known to be in the disk cache
    this.onDisk = new Set();

    this.onTileLoaded = null;

    this.mode = null;
    this.mbtiles = null;
    this.styler = null;
    this.ready = Promise.resolve();
    // the data schema of the tiles, see Tile
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
      if (!MBTiles) {
        throw new Error('MBTiles support must be installed first: \'npm install -g @mapbox/mbtiles\' if MapSCII is installed with npm -g, or \'npm install --no-save @mapbox/mbtiles\' in the MapSCII folder');
      }

      this.mode = modes.MBTiles;
      this.ready = this.loadMBTiles(source);
    } else {
      throw new Error(`unknown tile source "${source}": use ${Object.keys(config.sources).join(' or ')}, an http(s) URL or an .mbtiles file`);
    }
    return this.ready;
  }

  // Tiles of the default source live directly in the cache folder (as they always
  // did), every other source gets its own folder, so their data never mixes
  _cacheDirFor(source) {
    if (source === 'https://mapscii.me/' || source === 'http://mapscii.me/') {
      return paths.cache;
    }
    const name = this.sourceName || source.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]+/g, '_');
    return path.join(paths.cache, name);
  }

  // Reads a TileJSON (https://github.com/mapbox/tilejson-spec) for the tile URL,
  // zoom range, schema and attribution. A copy is kept on disk: when there is one,
  // MapSCII starts with it right away and fetches a fresh one in the background
  // (for the following downloads), instead of waiting for the network.
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
      // short, so it fits into the footer
      const host = url.replace(/^\w+:\/\//, '').split('/')[0];
      throw new Error(`could not reach ${host}: ${failureReason(error) || error.message}`);
    }
  }

  _useTileJSON(tilejson, url) {
    if (!tilejson.tiles || !tilejson.tiles.length) {
      throw new Error(`${url} lists no tiles`);
    }
    this.tileUrl = tilejson.tiles[0];
    if (!config.tileSchema && OpenMapTiles.matches(tilejson.vector_layers)) {
      this.schema = 'openmaptiles';
    }
    if (tilejson.maxzoom !== undefined) {
      config.tileRange = Math.min(config.tileRange, tilejson.maxzoom);
    }
    if (tilejson.attribution) {
      // the attribution is HTML meant for web maps
      this.attribution = plainText(tilejson.attribution);
    }
  }

  loadMBTiles(source) {
    return new Promise((resolve, reject) => {
      new MBTiles(source, (err, mbtiles) => {
        if (err) {
          return reject(err);
        }
        this.mbtiles = mbtiles;
        // the file's metadata lists its layers, which tell its schema
        mbtiles.getInfo((infoErr, info) => {
          if (!infoErr && info && !config.tileSchema && OpenMapTiles.matches(info.vector_layers)) {
            this.schema = 'openmaptiles';
          }
          if (!infoErr && info && info.attribution) {
            this.attribution = plainText(info.attribution);
          }
          resolve();
        });
      });
    });
  }

  useStyler(styler) {
    this.styler = styler;
  }

  // Returns the parsed tile if it is in memory, null otherwise - never blocks
  peekTile(z, x, y) {
    const key = this._key(z, x, y);
    const tile = this.cache.get(key);
    if (tile) {
      // refresh its position in the LRU order
      this.cache.delete(key);
      this.cache.set(key, tile);
      return tile;
    }
    return null;
  }

  // Called before each draw: tiles requested from now on are the most urgent ones
  beginFrame() {
    this.generation++;
  }

  // Starts loading a tile in the background (if it isn't already loading).
  // Tiles requested in the latest frame get fetched first, lowest rank first.
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

  // Downloads a tile into the disk cache when no visible tile is waiting, without
  // parsing it - so it's ready when the user pans or zooms there. Lower ranks first.
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
    // (a damaged file in the cache gets deleted there, and downloaded again)
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

  isLoading(z, x, y) {
    return this.loading.has(this._key(z, x, y));
  }

  // Why the tile couldn't be loaded the last time, or null
  failureOf(z, x, y) {
    return this.failReason.get(this._key(z, x, y)) || null;
  }

  // Failed tiles are tried again after config.tileRetryDelay, with the next
  // draw - this makes sure there is one, so the map fills in by itself once the
  // network is back
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

  _forgetPrefetch(key) {
    // unless the tile became visible in the meantime and is being loaded for real
    if (!this.loading.has(key)) {
      this.wanted.delete(key);
    }
  }

  // Returns a Promise of the parsed tile, loading it if needed
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

    // even tiles from the disk cache wait for the source: its TileJSON says how
    // to read them
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
      return tile;
    }, (error) => {
      this.loading.delete(key);
      this.wanted.delete(key);
      if (!error.cancelled) {
        this.failed.set(key, Date.now() + config.tileRetryDelay);
        this.failReason.set(key, failureReason(error));
        this._scheduleRetry();
        // a tile that can't be parsed must not stay in the disk cache
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

  // Downloads every tile within radiusKm around a point, from zoom 0 up to
  // maxZoom, into the disk cache - for fast or offline use of that area later.
  // onProgress(done, total, failed) is called after each tile.
  // The tiles within radiusKm around a point, from zoom 0 up to maxZoom, as
  // [{z, x, y}] - across the date line too
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

  // Downloads every tile within radiusKm around a point, from zoom 0 up to
  // maxZoom, into the disk cache - for fast or offline use of that area later.
  // Refuses areas which wouldn't fit on the disk. onProgress(done, total, failed)
  // is called after each tile.
  async downloadArea(lat, lon, radiusKm, maxZoom, onProgress) {
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
    // a few tiles at a time: the download queue limits the connections, this
    // keeps the open files and the memory in bounds for big areas
    const worker = async () => {
      while (next < tiles.length) {
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
    return {total: tiles.length, failed};
  }

  // Resolves once tiles can be loaded, i.e. the TileJSON or MBTiles file is read.
  // A TileJSON which could not be loaded is tried again after tileRetryDelay; once
  // it is there, the tiles which failed meanwhile are loaded right away.
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
        // until the next try, requests fail right away instead of asking again
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

  _notify(key) {
    if (this.onTileLoaded) {
      this.onTileLoaded(key);
    }
  }

  _key(z, x, y) {
    return z + '-' + x + '-' + y;
  }

  _addToCache(key, tile) {
    this.cache.set(key, tile);
    while (this.cache.size > this.cacheSize) {
      // the first key is the least recently used one
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  async _getHTTP(z, x, y) {
    if (config.persistDownloadedTiles) {
      const persistedTile = await this._getPersisted(z, x, y);
      if (persistedTile) {
        return persistedTile;
      }
    }
    return this._enqueueDownload(z, x, y, false);
  }

  // Queues a download (or joins the one already queued or running for this tile)
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

  // true if a should be downloaded before b
  _moreUrgent(a, b) {
    if (a.prefetch !== b.prefetch) {
      return !a.prefetch;
    }
    if (a.generation !== b.generation) {
      return a.generation > b.generation;
    }
    return a.rank < b.rank;
  }

  _pumpQueue() {
    while (this.queue.size) {
      let next = null;
      for (const [key, item] of this.queue) {
        if (!next || this._moreUrgent(item, next.item)) {
          next = {key, item};
        }
      }
      // visible tiles get their own connections; prefetching only starts when
      // no visible tile is waiting, and only on a few extra connections
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
        // e.g. a Wi-Fi login page instead of a tile must not get into the cache
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

  // drop the least urgent queued downloads - the view has long moved on from them
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

  async _download(z, x, y) {
    await this._whenReady();
    return this._fetch(this.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }

  // Fetches a URL into a Buffer
  async _fetch(url) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          agent: (parsedUrl) => parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent,
          timeout: config.tileRequestTimeout,
        });
        if (!res.ok) {
          const error = new Error(`could not load ${url}: HTTP ${res.status}`);
          error.status = res.status;
          error.retry = res.status >= 500;
          throw error;
        }
        return await res.buffer();
      } catch (error) {
        // dropped connections (e.g. a kept-alive one the server just closed) and
        // server hiccups are worth another try right away - timeouts and 404s aren't
        const retry = error.retry || (error.type === 'system');
        if (!retry || attempt >= config.tileRequestRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  _getMBTile(z, x, y) {
    return new Promise((resolve, reject) => {
      this.mbtiles.getTile(z, x, y, (err, buffer) => {
        if (err) {
          return reject(err);
        }
        resolve(buffer);
      });
    });
  }

  _initPersistence() {
    try {
      this._createFolder(this.cacheDir);
    } catch (error) {
      config.persistDownloadedTiles = false;
    }
  }

  _persistTile(z, x, y, buffer) {
    // servers which compress tiles only for the transfer hand them over unzipped -
    // they are stored zipped, which takes about a third of the space
    if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
      zlib.gzip(buffer, (err, zipped) => {
        if (!err) {
          this._persistTile(z, x, y, zipped);
        }
      });
      return;
    }
    try {
      this._createFolder(path.join(this.cacheDir, z.toString()));
      const filePath = this._persistPath(z, x, y);
      // write to a temporary file first, so an interrupted write never leaves a broken tile behind
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      const key = this._key(z, x, y);
      const discard = () => fs.unlink(tmpPath, () => null);
      fs.writeFile(tmpPath, buffer, (err) => {
        if (err) {
          // e.g. the disk is full: don't leave a partial file behind
          return discard();
        }
        fs.rename(tmpPath, filePath, (err) => {
          if (err) {
            return discard();
          }
          this.onDisk.add(key);
        });
      });
    } catch (error) {
      void 0;
    }
  }

  // The tile from the disk cache, or false. A damaged file (e.g. cut short, or
  // from a download which wasn't a tile) is deleted, so the tile gets downloaded
  // again right away. Tiles are stored gzipped, so an empty file is damaged too.
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

  _persistPath(z, x, y) {
    return path.join(this.cacheDir, z.toString(), `${x}-${y}.pbf`);
  }

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

// The tile ranges within radiusKm around a point for each zoom level up to
// maxZoom, as [{z, left, right, top, bottom}]; left and right may lie beyond
// the date line (wrap them with the grid size)
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

// MB free on the disk holding the folder, or null if that can't be found out
function freeSpaceMB(folder) {
  try {
    const stats = fs.statfsSync(folder);
    return Math.floor(stats.bavail * stats.bsize / 1024 / 1024);
  } catch (error) {
    return null;
  }
}

// The attribution of a source (HTML meant for web maps) as one line of text,
// without control characters - they could change the terminal's state
function plainText(html) {
  const entities = {'&copy;': '©', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' '};
  return String(html)
    .replace(/<[^>]*>/g, '')
    .replace(/&(copy|amp|lt|gt|quot|#39|nbsp);/g, (entity) => entities[entity])
    // eslint-disable-next-line no-control-regex
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim();
}

function isGzipped(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

// The tile's data unzipped (in the background, off the main thread), or null
// if it isn't a vector tile - e.g. an error page or a broken download
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

// The same, at once (for tests)
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

// Whether unzipped data has the shape of a vector tile: a sequence of layers
// (protobuf field 3) which ends exactly at the end of the data. Cheap, and
// enough to turn away error pages and broken downloads.
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

// A short reason for a failed tile, for the footer; null when the server simply
// has no tile there
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
  if (error.type === 'system' || error.type === 'request-timeout') {
    return 'no connection to the tile server';
  }
  return error.message.slice(0, 60);
}

TileSource.looksLikeTile = looksLikeTile;
TileSource.plainText = plainText;
module.exports = TileSource;
