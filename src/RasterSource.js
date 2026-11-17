// Picture tiles (satellite JPEG, elevation PNG): cached on disk, decoded ones kept in memory within a budget.
// While a tile loads, a coarser one stands in.
'use strict';
const fs = require('fs');
const path = require('path');
const Net = require('./Net');
const Png = require('./images/Png');
const Jpeg = require('./images/Jpeg');

const SOURCES = {
  imagery: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 19,
    format: 'jpg',
    attribution: 'Powered by Esri - Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
  terrain: {
    // metres = (R * 256 + G + B / 256) - 32768
    url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    maxZoom: 15,
    format: 'png',
    attribution: 'Terrain: Mapzen terrain tiles on AWS (SRTM, GMTED, ETOPO1 and others)',
  },
};

class RasterSource {
  // options: {cacheDir, memoryMB, fetchBuffer (for tests), onLoad}
  constructor(name, {cacheDir = null, memoryMB = 25, fetchBuffer = Net.fetchBuffer, onLoad = () => null} = {}) {
    const source = SOURCES[name];
    if (!source) throw new Error(`no picture source "${name}"`);
    Object.assign(this, source);
    this.name = name;
    this.cacheDir = cacheDir ? path.join(cacheDir, name) : null;
    this.budget = memoryMB * 1024 * 1024;
    this.fetchBuffer = fetchBuffer;
    this.onLoad = onLoad;
    this.memory = new Map();
    this.loading = new Map();
    this.failed = new Map();
    this.bytes = 0;
    // neighbouring samples are mostly in the same tile, so remember the last one
    this.clock = 0;
    this.last = null;
    this.notOnDisk = new Set();
    // A few downloads at a time, newest first; queued ones no frame asked for lately are dropped.
    this.downloads = 0;
    this.waiting = [];
    // frame each queued tile was last asked for (Infinity: from get(), never dropped)
    this.wanted = new Map();
    this.frame = 0;
  }

  // Starts a new frame, for dropping queued tiles no frame wants
  beginFrame() {
    this.frame++;
  }

  // Whether a queued tile wasn't asked for in this frame or the one before
  _stale(key) {
    const wanted = this.wanted.get(key);
    return (wanted === undefined ? -Infinity : wanted) < this.frame - 1;
  }

  // Downloads a URL, waiting for a free slot first
  async _download(url, key) {
    if (this.downloads >= RasterSource.maxDownloads) {
      await new Promise((resolve, reject) => this.waiting.push({key, resolve, reject}));
    }
    this.downloads++;
    try {
      return await this.fetchBuffer(url);
    } finally {
      this.downloads--;
      this._next();
    }
  }

  // Starts the newest wanted queued download, dropping stale ones
  _next() {
    while (this.waiting.length) {
      let best = -1;
      for (let i = this.waiting.length - 1; i >= 0; i--) {
        const entry = this.waiting[i];
        if (this._stale(entry.key)) {
          this.waiting.splice(i, 1);
          entry.reject(Object.assign(new Error('not needed any more'), {notNeeded: true}));
          if (best > i) best--;
        } else if (best === -1 || this.wanted.get(entry.key) > this.wanted.get(this.waiting[best].key)) {
          best = i;
        }
      }
      if (best === -1) return;
      const [entry] = this.waiting.splice(best, 1);
      entry.resolve();
      return;
    }
  }

  // x and y are below 2 ** 20 up to zoom 20
  _key(z, x, y) {
    return (z * 1048576 + x) * 1048576 + y;
  }

  // The decoded tile if it is in memory, else null; it then loads in the background
  peek(z, x, y) {
    const tile = this.memory.get(this._key(z, x, y));
    if (tile) {
      tile.used = this.clock++;
      return tile;
    }
    this.request(z, x, y);
    return null;
  }

  // The tile or the nearest coarser one in memory: {tile, z, x, y, scale, ox, oy}
  best(z, x, y) {
    const last = this.last;
    if (last && last.qz === z && last.qx === x && last.qy === y) return last.found;
    let found = null;
    for (let up = 0; up <= Math.min(z, 6); up++) {
      const s = 1 << up;
      const tile = up === 0 ? this.peek(z, x, y) : this.memory.get(this._key(z - up, x >> up, y >> up));
      if (tile) {
        tile.used = this.clock++;
        found = {tile, z: z - up, scale: s, ox: (x % s) / s, oy: (y % s) / s};
        break;
      }
    }
    // only hits are remembered, so a missing tile is asked for again
    this.last = found ? {qz: z, qx: x, qy: y, found} : null;
    if (!found) {
      // coarser tiles from disk stand in; they aren't downloaded for that
      for (let up = 1; up <= Math.min(z, 3); up++) this.request(z - up, x >> up, y >> up, {diskOnly: true});
    }
    return found;
  }

  // How many tiles the screen still waits for
  missing() {
    let stale = 0;
    for (const entry of this.waiting) if (this._stale(entry.key)) stale++;
    return this.loading.size - stale;
  }

  // failed tiles are retried after 30 s
  failures() {
    let count = 0;
    for (const at of this.failed.values()) if (Date.now() - at < 30000) count++;
    return count;
  }

  // Starts loading a tile in the background; diskOnly never downloads it
  request(z, x, y, {diskOnly = false, keep = false} = {}) {
    const key = this._key(z, x, y);
    if (this.memory.has(key)) return;
    if (!diskOnly) this.wanted.set(key, keep ? Infinity : Math.max(this.frame, this.wanted.get(key) || 0));
    if (this.loading.has(key)) return;
    if (diskOnly && (!this.cacheDir || this.notOnDisk.has(key))) return;
    const failedAt = this.failed.get(key);
    if (failedAt && Date.now() - failedAt < 30000) return;
    const promise = this._load(z, x, y, diskOnly).then((tile) => {
      this.loading.delete(key);
      this.wanted.delete(key);
      this.failed.delete(key);
      this._keep(key, tile);
      this.onLoad();
      return tile;
    }, (error) => {
      this.loading.delete(key);
      if (!diskOnly) this.wanted.delete(key);
      if (error && error.notOnDisk) this.notOnDisk.add(key);
      else if (!(error && error.notNeeded)) this.failed.set(key, Date.now());
      this.onLoad();
      return null;
    });
    this.loading.set(key, promise);
    return promise;
  }

  // Resolves with the decoded tile, or null (for --print)
  get(z, x, y) {
    const key = this._key(z, x, y);
    if (this.memory.has(key)) return Promise.resolve(this.memory.get(key));
    this.wanted.set(key, Infinity);
    return this.loading.get(key) || this.request(z, x, y, {keep: true}) || Promise.resolve(null);
  }

  // Reads a tile from the disk, else downloads and stores it, then decodes it
  async _load(z, x, y, diskOnly = false) {
    const file = this.cacheDir ? path.join(this.cacheDir, String(z), `${x}-${y}.${this.format}`) : null;
    let bytes = null;
    if (file) {
      try {
        bytes = await fs.promises.readFile(file);
      } catch (error) {
        bytes = null;
      }
    }
    let fresh = false;
    if (!bytes && diskOnly) throw Object.assign(new Error('not on the disk'), {notOnDisk: true});
    if (!bytes) {
      bytes = await this._download(this.url.replace('{z}', z).replace('{x}', x).replace('{y}', y), this._key(z, x, y));
      fresh = true;
    }
    const tile = this.format === 'png' ? Png.decode(bytes) : Jpeg.decode(bytes);
    if (fresh && file) {
      try {
        await fs.promises.mkdir(path.dirname(file), {recursive: true});
        await fs.promises.writeFile(file, bytes);
        this.notOnDisk.delete(this._key(z, x, y));
      } catch (error) {
        void 0;
      }
    }
    return tile;
  }

  // Keeps a decoded tile in memory, dropping the least recently used beyond the budget
  _keep(key, tile) {
    tile.used = this.clock++;
    this.memory.set(key, tile);
    this.bytes += tile.data.length;
    this.last = null;
    while (this.bytes > this.budget && this.memory.size > 1) {
      let oldest = null;
      for (const [k, t] of this.memory) {
        if (k !== key && (oldest === null || t.used < this.memory.get(oldest).used)) oldest = k;
      }
      const old = this.memory.get(oldest);
      this.bytes -= old.data.length + (old.heights ? old.heights.byteLength : 0);
      this.memory.delete(oldest);
    }
  }

  // x, y from 0 to 1 at zoom 0; [r, g, b] or null
  colorAt(wx, wy, z) {
    const c = this.rgbAt(wx, wy, z);
    return c === -1 ? null : [c >> 16 & 255, c >> 8 & 255, c & 255];
  }

  // 0xRRGGBB or -1, without an array
  rgbAt(wx, wy, z) {
    const n = 1 << z;
    const tx = Math.floor(wx * n);
    const ty = Math.floor(wy * n);
    if (ty < 0 || ty >= n) return -1;
    const x = ((tx % n) + n) % n;
    const found = this.best(z, x, ty);
    if (!found) return -1;
    const {tile, scale, ox, oy} = found;
    const fx = ((wx * n - tx) / scale + ox) * tile.width;
    const fy = ((wy * n - ty) / scale + oy) * tile.height;
    const px = Math.min(tile.width - 1, Math.max(0, Math.floor(fx)));
    const py = Math.min(tile.height - 1, Math.max(0, Math.floor(fy)));
    const i = (py * tile.width + px) * 4;
    return (tile.data[i] << 16) | (tile.data[i + 1] << 8) | tile.data[i + 2];
  }

  // bilinear, or slopes show as stripes
  heightAt(wx, wy, z) {
    const n = 1 << z;
    const tx = Math.floor(wx * n);
    const ty = Math.floor(wy * n);
    if (ty < 0 || ty >= n) return null;
    const found = this.best(z, ((tx % n) + n) % n, ty);
    if (!found) return null;
    const {tile, scale, ox, oy} = found;
    const fx = ((wx * n - tx) / scale + ox) * tile.width - 0.5;
    const fy = ((wy * n - ty) / scale + oy) * tile.height - 0.5;
    const x0 = Math.max(0, Math.min(tile.width - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(tile.height - 1, Math.floor(fy)));
    const x1 = Math.min(tile.width - 1, x0 + 1);
    const y1 = Math.min(tile.height - 1, y0 + 1);
    const tx1 = Math.max(0, Math.min(1, fx - x0));
    const ty1 = Math.max(0, Math.min(1, fy - y0));
    if (!tile.heights) {
      tile.heights = heightsOf(tile);
      this.bytes += tile.heights.byteLength;
    }
    const heights = tile.heights;
    const w = tile.width;
    const top = heights[y0 * w + x0] * (1 - tx1) + heights[y0 * w + x1] * tx1;
    const bottom = heights[y1 * w + x0] * (1 - tx1) + heights[y1 * w + x1] * tx1;
    return top * (1 - ty1) + bottom * ty1;
  }
}

// A terrain tile's heights in metres, worked out once
function heightsOf(tile) {
  const heights = new Float32Array(tile.width * tile.height);
  const d = tile.data;
  for (let i = 0; i < heights.length; i++) heights[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return heights;
}

RasterSource.SOURCES = SOURCES;
RasterSource.maxDownloads = 6;
module.exports = RasterSource;
