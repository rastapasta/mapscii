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
const http = require('http');
const https = require('https');
const fetch = require('node-fetch');
const envPaths = require('env-paths');
const paths = envPaths('mapscii');

const Tile = require('./Tile');
const config = require('./config');
const utils = require('./utils');

// https://github.com/mapbox/node-mbtiles has native build dependencies (sqlite3)
// To maximize MapSCII’s compatibility, MBTiles support must be manually added via
// $> npm install -g @mapbox/mbtiles
let MBTiles = null;
try {
  MBTiles = require('@mapbox/mbtiles');
} catch (err) {void 0;}

const modes = {
  MBTiles: 1,
  VectorTile: 2,
  HTTP: 3,
};

// Reuse connections instead of doing a TCP + TLS handshake for every tile
const agentOptions = {keepAlive: true, maxSockets: config.maxConnections};
const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

class TileSource {
  init(source) {
    this.source = source;

    // parsed tiles, kept in least-recently-used order (Map keeps insertion order)
    this.cache = new Map();
    this.cacheSize = config.tileCacheSize;

    // tiles currently being loaded: key -> Promise
    this.loading = new Map();
    // tiles which failed to load: key -> timestamp before which we don't retry
    this.failed = new Map();

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

    if (this.source.startsWith('http')) {
      if (config.persistDownloadedTiles) {
        this._initPersistence();
      }

      this.mode = modes.HTTP;

    } else if (this.source.endsWith('.mbtiles')) {
      if (!MBTiles) {
        throw new Error('MBTiles support must be installed with following command: \'npm install -g @mapbox/mbtiles\'');
      }

      this.mode = modes.MBTiles;
      this.ready = this.loadMBTiles(source);
    } else {
      throw new Error('source type isn\'t supported yet');
    }
    return this.ready;
  }

  loadMBTiles(source) {
    return new Promise((resolve, reject) => {
      new MBTiles(source, (err, mbtiles) => {
        if (err) {
          return reject(err);
        }
        this.mbtiles = mbtiles;
        resolve();
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
    fs.access(this._persistPath(z, x, y), (err) => {
      if (!err) {
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

    let promise;
    switch (this.mode) {
      case modes.MBTiles:
        promise = this._getMBTile(z, x, y);
        break;
      case modes.HTTP:
        promise = this._getHTTP(z, x, y);
        break;
    }

    promise = promise.then((buffer) => {
      return new Tile(this.styler).load(buffer);
    }).then((tile) => {
      this.loading.delete(key);
      this.wanted.delete(key);
      this.failed.delete(key);
      this._addToCache(key, tile);
      this._notify(key);
      return tile;
    }, (error) => {
      this.loading.delete(key);
      this.wanted.delete(key);
      if (!error.cancelled) {
        this.failed.set(key, Date.now() + config.tileRetryDelay);
        // a tile that can't be parsed must not stay in the disk cache
        if (this.mode === modes.HTTP && config.persistDownloadedTiles) {
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
  async downloadArea(lat, lon, radiusKm, maxZoom, onProgress) {
    if (this.mode !== modes.HTTP || !config.persistDownloadedTiles) {
      throw new Error('downloading an area needs a HTTP tile source and persistDownloadedTiles');
    }
    const dLat = radiusKm / 111.32;
    const dLon = radiusKm / (111.32 * Math.cos(lat * Math.PI / 180));
    const tiles = [];
    for (let z = 0; z <= maxZoom; z++) {
      const topLeft = utils.ll2tile(Math.max(-180, lon - dLon), Math.min(85.0511, lat + dLat), z);
      const bottomRight = utils.ll2tile(Math.min(180, lon + dLon), Math.max(-85.0511, lat - dLat), z);
      const max = Math.pow(2, z) - 1;
      for (let y = Math.max(0, Math.floor(topLeft.y)); y <= Math.min(max, Math.floor(bottomRight.y)); y++) {
        for (let x = Math.max(0, Math.floor(topLeft.x)); x <= Math.min(max, Math.floor(bottomRight.x)); x++) {
          tiles.push({z, x, y});
        }
      }
    }

    let done = 0;
    let failed = 0;
    await Promise.all(tiles.map(async ({z, x, y}) => {
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
    }));
    return {total: tiles.length, failed};
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
      this._download(item.z, item.x, item.y).then((buffer) => {
        if (config.persistDownloadedTiles) {
          this._persistTile(item.z, item.x, item.y, buffer);
        }
        return buffer;
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
    const url = this.source + [z, x, y].join('/') + '.pbf';
    const res = await fetch(url, {
      agent: (parsedUrl) => parsedUrl.protocol === 'http:' ? httpAgent : httpsAgent,
      timeout: config.tileRequestTimeout,
    });
    if (!res.ok) {
      throw new Error(`could not load tile ${url}: HTTP ${res.status}`);
    }
    return res.buffer();
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
      this._createFolder(paths.cache);
    } catch (error) {
      config.persistDownloadedTiles = false;
    }
  }

  _persistTile(z, x, y, buffer) {
    try {
      this._createFolder(path.join(paths.cache, z.toString()));
      const filePath = this._persistPath(z, x, y);
      // write to a temporary file first, so an interrupted write never leaves a broken tile behind
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      const key = this._key(z, x, y);
      fs.writeFile(tmpPath, buffer, (err) => {
        if (!err) {
          fs.rename(tmpPath, filePath, (err) => {
            if (!err) {
              this.onDisk.add(key);
            }
          });
        }
      });
    } catch (error) {
      void 0;
    }
  }

  async _getPersisted(z, x, y) {
    try {
      return await fs.promises.readFile(this._persistPath(z, x, y));
    } catch (error) {
      return false;
    }
  }

  _persistPath(z, x, y) {
    return path.join(paths.cache, z.toString(), `${x}-${y}.pbf`);
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

module.exports = TileSource;
