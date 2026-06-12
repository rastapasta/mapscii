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
import { fileURLToPath } from 'url';

import Tile from './Tile';
import config from './config';
import Styler from './Styler';
import TileWorkerPool from './TileWorkerPool';

const cacheRoot = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache');
const cacheDir = path.join(cacheRoot, 'mapscii', 'cache-2');
const legacyCacheDir = path.join(homedir(), '.mapscii', 'cache-2');

export interface TileCacheResetResult {
  memoryEntries: number;
  persistentPaths: string[];
  errors: string[];
}

export interface TileCacheResetOptions {
  persistent?: boolean;
}

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
  public vectorTilePath: string | null = null;
  public styler: Styler | null = null;
  public maxZoom: number | null = null;
  // De-dupe concurrent requests for the same tile (the globe view requests
  // the same parent tile from many fallback paths simultaneously)
  private inflight: Map<string, Promise<Tile>> = new Map();
  // Tiles the source definitively doesn't have (per session)
  private notFound: Set<string> = new Set();
  private cacheGeneration: number = 0;

  async init(source: string): Promise<void> {
    this.source = source;
    this.cache = {};
    this.cached = [];
    this.vectorTilePath = null;

    if (this.source.startsWith('http')) {
      if (config.persistDownloadedTiles) {
        this._initPersistence();
      }

      this.mode = TileMode.HTTP;
      this.maxZoom = config.maxZoom;
    } else if (this._isMBTilesSource(this.source)) {
      if (!MBTiles) {
        throw new Error('MBTiles support must be installed with following command: \'npm install -g @mapbox/mbtiles\'');
      }

      this.mode = TileMode.MBTiles;
      await this.loadMBTiles(this._sourceToLocalPath(source));
    } else if (this._isVectorTileSource(this.source)) {
      this.mode = TileMode.VectorTile;
      this.vectorTilePath = this._sourceToLocalPath(source);
      // The standalone tile is served as 0/0/0 and overzoomed: Mapscii sets
      // tileRange to 0 for this mode so all zoom levels scale the same tile.
      this.maxZoom = 8;
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

  isSingleVectorTile(): boolean {
    return this.mode === TileMode.VectorTile;
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
    const generation = this.cacheGeneration;

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
        if (generation === this.cacheGeneration) {
          this._commitToCache(cacheKey, tile);
        }
        return tile;
      })
      .catch((err) => {
        if (err instanceof TileNotFoundError && generation === this.cacheGeneration) {
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

  resetCache(options: TileCacheResetOptions = {}): TileCacheResetResult {
    const memoryEntries = Object.keys(this.cache).length + this.cached.length + this.notFound.size + this.inflight.size;
    this.cacheGeneration += 1;
    this.cache = {};
    this.cached = [];
    this.notFound.clear();
    this.inflight.clear();

    const result: TileCacheResetResult = {
      memoryEntries,
      persistentPaths: [],
      errors: [],
    };

    if (options.persistent !== false) {
      [cacheDir, legacyCacheDir].forEach((folder) => {
        try {
          if (fs.existsSync(folder)) {
            fs.rmSync(folder, { recursive: true, force: true });
            result.persistentPaths.push(folder);
          }
        } catch (error: unknown) {
          result.errors.push(error instanceof Error ? error.message : String(error));
        }
      });
    }

    if (config.persistDownloadedTiles && options.persistent !== false) {
      this._initPersistence();
    }

    return result;
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
      case TileMode.VectorTile:
        return this._getVectorTile(z, x, y);
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
          return await this._parseTile(persistedTile, z);
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
    const tile = await this._parseTile(buffer, z);
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
    return this._parseTile(buffer, z);
  }

  private async _getVectorTile(z: number, x: number, y: number): Promise<Tile> {
    if (z !== 0 || x !== 0 || y !== 0) {
      throw new TileNotFoundError(`single vector tile source only provides 0/0/0, requested ${z}/${x}/${y}`);
    }
    if (!this.vectorTilePath) {
      throw new Error('Vector tile source not initialized');
    }

    const buffer = await fs.promises.readFile(this.vectorTilePath);
    return this._parseTile(buffer, z);
  }

  private async _parseTile(buffer: Buffer, z: number): Promise<Tile> {
    if (config.useTileWorker && this.styler) {
      try {
        const payload = await TileWorkerPool.parse(buffer, z, this.styler, config.language);
        return Tile.fromParsedLayers(this.styler, payload, z);
      } catch {
        // Fall back to main-thread parsing if worker startup/import/parse fails.
      }
    }

    return new Tile(this.styler).load(buffer, z);
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
    const relativePath = path.join(z.toString(), `${x}-${y}.pbf`);

    try {
      return fs.readFileSync(path.join(cacheDir, relativePath));
    } catch {
      try {
        const buffer = fs.readFileSync(path.join(legacyCacheDir, relativePath));
        this._persistTile(z, x, y, buffer);
        return buffer;
      } catch {
        return false;
      }
    }
  }

  private _deletePersisted(z: number, x: number, y: number): void {
    [cacheDir, legacyCacheDir].forEach((folder) => {
      try {
        fs.unlinkSync(path.join(folder, z.toString(), `${x}-${y}.pbf`));
      } catch {
        // ignore
      }
    });
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

  private _sourceToLocalPath(source: string): string {
    return source.startsWith('file://') ? fileURLToPath(source) : source;
  }

  private _isMBTilesSource(source: string): boolean {
    return this._sourceToLocalPath(source).toLowerCase().endsWith('.mbtiles');
  }

  private _isVectorTileSource(source: string): boolean {
    const normalized = this._sourceToLocalPath(source).toLowerCase();
    return normalized.endsWith('.pbf') || normalized.endsWith('.mvt');
  }
}
