/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Source for VectorTiles - supports
  * remote TileServer
  * local MBTiles and VectorTiles
*/

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

import Tile from './Tile';
import config from './config';
import Styler from './Styler';

// Use Bun's home directory for cache
const cacheDir = path.join(homedir(), '.mapscii', 'cache-2');

// MBTiles interface for dynamic import
interface MBTilesInstance {
  _db: {
    all(sql: string, callback: (err: Error | null, rows: Array<{ max_zoom?: number }>) => void): void;
  };
  getTile(z: number, x: number, y: number, callback: (err: Error | null, data: Buffer, headers: Record<string, string>) => void): void;
}

type MBTilesConstructor = new (path: string, callback: (err: Error | null, mbtiles: MBTilesInstance) => void) => MBTilesInstance;

// https://github.com/mapbox/node-mbtiles has native build dependencies (sqlite3)
// To maximize MapSCII's compatibility, MBTiles support must be manually added via
// $> npm install -g @mapbox/mbtiles
let MBTiles: MBTilesConstructor | null = null;
try {
  MBTiles = (await import('@mapbox/mbtiles')).default as unknown as MBTilesConstructor;
} catch {
  // MBTiles support not available
}

enum TileMode {
  MBTiles = 1,
  VectorTile = 2,
  HTTP = 3,
}

/**
 * Thrown when a tile definitively doesn't exist in the source (e.g. HTTP 404,
 * zoom level not present). Callers can use this to distinguish "this zoom
 * level isn't available" from transient network/parse failures.
 */
export class TileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TileNotFoundError';
  }
}

export default class TileSource {
  public source: string = '';
  public cache: Record<string, Tile> = {};
  public cacheSize: number = 16;
  public cached: string[] = [];
  public mode: TileMode | null = null;
  public mbtiles: MBTilesInstance | null = null;
  public styler: Styler | null = null;
  public maxZoom: number | null = null;
  // De-dupe concurrent requests for the same tile (the globe view requests
  // the same parent tile from many fallback paths simultaneously)
  private inflight: Map<string, Promise<Tile>> = new Map();
  // Tiles the source definitively doesn't have (per session)
  private notFound: Set<string> = new Set();

  async init(source: string): Promise<void> {
    this.source = source;
    this.cache = {};
    this.cached = [];

    if (this.source.startsWith('http')) {
      if (config.persistDownloadedTiles) {
        this._initPersistence();
      }

      this.mode = TileMode.HTTP;
      this.maxZoom = config.maxZoom;
    } else if (this.source.endsWith('.mbtiles')) {
      if (!MBTiles) {
        throw new Error('MBTiles support must be installed with following command: \'npm install -g @mapbox/mbtiles\'');
      }

      this.mode = TileMode.MBTiles;
      await this.loadMBTiles(source);
    } else {
      throw new Error('source type isn\'t supported yet');
    }
  }

  async loadMBTiles(source: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!MBTiles) {
        reject(new Error('MBTiles not available'));
        return;
      }

      new MBTiles(source, (err: Error | null, mbtiles: MBTilesInstance) => {
        if (err) {
          reject(err);
          return;
        }
        this.mbtiles = mbtiles;

        this.mbtiles._db.all(
          'SELECT MAX(zoom_level) as max_zoom FROM tiles',
          (err: Error | null, rows: Array<{ max_zoom?: number }>) => {
            if (err || !rows || !rows[0]) {
              this.maxZoom = config.maxZoom;
            } else {
              this.maxZoom = rows[0].max_zoom ?? config.maxZoom;
            }
            resolve();
          }
        );
      });
    });
  }

  useStyler(styler: Styler): void {
    this.styler = styler;
  }

  getMaxZoom(): number {
    return this.maxZoom ?? config.maxZoom;
  }

  async getTile(z: number, x: number, y: number): Promise<Tile> {
    if (!this.mode) {
      throw new Error('no TileSource defined');
    }

    // Reject out-of-range coordinates without hitting the network
    const gridSize = 1 << z;
    if (z < 0 || z > 30 || x < 0 || x >= gridSize || y < 0 || y >= gridSize) {
      throw new TileNotFoundError(`tile out of range: ${z}/${x}/${y}`);
    }

    const cacheKey = [z, x, y].join('-');

    if (this.notFound.has(cacheKey)) {
      throw new TileNotFoundError(`tile not found: ${z}/${x}/${y}`);
    }

    const cached = this.cache[cacheKey];
    if (cached) {
      return cached;
    }

    const pending = this.inflight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const promise = this._loadTile(z, x, y)
      .then((tile) => {
        // Only fully loaded tiles enter the cache, so concurrent callers can
        // never observe a half-parsed tile with empty layers.
        this._commitToCache(cacheKey, tile);
        return tile;
      })
      .catch((err) => {
        if (err instanceof TileNotFoundError) {
          this.notFound.add(cacheKey);
        }
        throw err;
      })
      .finally(() => {
        this.inflight.delete(cacheKey);
      });

    this.inflight.set(cacheKey, promise);
    return promise;
  }

  private _commitToCache(cacheKey: string, tile: Tile): void {
    while (this.cached.length >= this.cacheSize) {
      const oldest = this.cached.shift();
      if (oldest === undefined) break;
      delete this.cache[oldest];
    }
    this.cached.push(cacheKey);
    this.cache[cacheKey] = tile;
  }

  private async _loadTile(z: number, x: number, y: number): Promise<Tile> {
    switch (this.mode) {
      case TileMode.MBTiles:
        return this._getMBTile(z, x, y);
      case TileMode.HTTP:
        return this._getHTTP(z, x, y);
      default:
        throw new Error('Unknown tile mode');
    }
  }

  private async _getHTTP(z: number, x: number, y: number): Promise<Tile> {
    if (config.persistDownloadedTiles) {
      const persistedTile = this._getPersisted(z, x, y);
      if (persistedTile) {
        try {
          return await new Tile(this.styler).load(persistedTile);
        } catch {
          // Corrupt persisted tile (e.g. an HTTP error page persisted by an
          // older version): delete it and fall through to a fresh download.
          this._deletePersisted(z, x, y);
        }
      }
    }

    const response = await fetch(this.source + [z, x, y].join('/') + '.pbf');
    if (!response.ok) {
      if (response.status === 404 || response.status === 410 || response.status === 204) {
        throw new TileNotFoundError(`tile not found: ${z}/${x}/${y} (HTTP ${response.status})`);
      }
      throw new Error(`tile request failed: ${z}/${x}/${y} (HTTP ${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    // Parse first, persist only what parsed successfully
    const tile = await new Tile(this.styler).load(buffer);
    if (config.persistDownloadedTiles) {
      this._persistTile(z, x, y, buffer);
    }
    return tile;
  }

  private async _getMBTile(z: number, x: number, y: number): Promise<Tile> {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      if (!this.mbtiles) {
        reject(new Error('MBTiles not initialized'));
        return;
      }
      this.mbtiles.getTile(z, x, y, (err: Error | null, data: Buffer) => {
        if (err) {
          // node-mbtiles reports missing tiles as plain errors
          reject(new TileNotFoundError(err.message || `tile not found: ${z}/${x}/${y}`));
          return;
        }
        resolve(data);
      });
    });
    return new Tile(this.styler).load(buffer);
  }

  private _initPersistence(): void {
    try {
      this._createFolder(cacheDir);
    } catch {
      config.persistDownloadedTiles = false;
    }
  }

  private _persistTile(z: number, x: number, y: number, buffer: Buffer): void {
    const zoom = z.toString();
    this._createFolder(path.join(cacheDir, zoom));
    const filePath = path.join(cacheDir, zoom, `${x}-${y}.pbf`);
    fs.writeFile(filePath, buffer, () => { /* ignore errors */ });
  }

  private _getPersisted(z: number, x: number, y: number): Buffer | false {
    try {
      return fs.readFileSync(path.join(cacheDir, z.toString(), `${x}-${y}.pbf`));
    } catch {
      return false;
    }
  }

  private _deletePersisted(z: number, x: number, y: number): void {
    try {
      fs.unlinkSync(path.join(cacheDir, z.toString(), `${x}-${y}.pbf`));
    } catch {
      // ignore
    }
  }

  private _createFolder(folderPath: string): boolean {
    try {
      fs.mkdirSync(folderPath, { recursive: true });
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return true;
      throw error;
    }
  }
}
