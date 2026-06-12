import { PNG } from 'pngjs';

import config from './config';
import { clamp, ll2tile } from './utils';

interface TerrainTile {
  width: number;
  height: number;
  data: Buffer;
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function gray(value: number): string {
  const channel = toHex(value);
  return `#${channel}${channel}${channel}`;
}

function rgbToHex(rgb: number[]): string {
  return `#${toHex(rgb[0])}${toHex(rgb[1])}${toHex(rgb[2])}`;
}

function parseHex(hex: string): number[] {
  const value = hex.slice(1);
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function interpolateColor(startHex: string, endHex: string, t: number): string {
  const start = parseHex(startHex);
  const end = parseHex(endHex);
  return rgbToHex([
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
    start[2] + (end[2] - start[2]) * t,
  ]);
}

function blendWithBlack(hex: string, opacity: number): string {
  const rgb = parseHex(hex);
  return rgbToHex(rgb.map((channel) => channel * opacity));
}

export interface TerrainTileCoord {
  key: string;
  z: number;
  x: number;
  y: number;
}

export default class TerrainSource {
  private cache: Map<string, Promise<TerrainTile | null>> = new Map();
  // Settled tiles, readable synchronously so a frame can sample thousands of
  // cells without allocating a promise per cell.
  private resolved: Map<string, TerrainTile | null> = new Map();

  /** Terrain tile coordinates covering a lat/lon at the given map zoom. */
  tileCoordFor(lon: number, lat: number, zoom: number): TerrainTileCoord | null {
    const terrainZoom = clamp(Math.floor(zoom), config.terrain.minZoom, config.terrain.maxZoom);
    const tileCoord = ll2tile(lon, lat, terrainZoom);
    const gridSize = 1 << terrainZoom;
    const x = ((Math.floor(tileCoord.x) % gridSize) + gridSize) % gridSize;
    const y = Math.floor(tileCoord.y);

    if (y < 0 || y >= gridSize) return null;

    return { key: `${terrainZoom}/${x}/${y}`, z: terrainZoom, x, y };
  }

  /** Fetch and decode a terrain tile so colorAtSync can sample it. */
  async prefetch(z: number, x: number, y: number): Promise<void> {
    await this._getTile(z, x, y);
  }

  /**
   * Sample the terrain color for a lat/lon from already-prefetched tiles.
   * Returns undefined when the tile isn't resolved (or failed to load).
   */
  colorAtSync(lon: number, lat: number, zoom: number): string | undefined {
    if (!config.terrain.enabled) return undefined;

    const coord = this.tileCoordFor(lon, lat, zoom);
    if (!coord) return undefined;

    const tile = this.resolved.get(coord.key);
    if (!tile) return undefined;

    const tileCoord = ll2tile(lon, lat, coord.z);
    return this._sample(tile, tileCoord.x, tileCoord.y);
  }

  async colorAt(lon: number, lat: number, zoom: number): Promise<string | undefined> {
    if (!config.terrain.enabled) return undefined;

    const coord = this.tileCoordFor(lon, lat, zoom);
    if (!coord) return undefined;

    const tile = await this._getTile(coord.z, coord.x, coord.y);
    if (!tile) return undefined;

    const tileCoord = ll2tile(lon, lat, coord.z);
    return this._sample(tile, tileCoord.x, tileCoord.y);
  }

  private _sample(tile: TerrainTile, tileX: number, tileY: number): string | undefined {
    const pixelX = clamp(Math.floor((tileX - Math.floor(tileX)) * tile.width), 0, tile.width - 1);
    const pixelY = clamp(Math.floor((tileY - Math.floor(tileY)) * tile.height), 0, tile.height - 1);
    const opacity = clamp(config.terrain.opacity, 0, 1);
    const elevation = this._elevation(tile, pixelX, pixelY);

    if (config.terrain.mode === 'elevation') {
      return blendWithBlack(this._elevationColor(elevation), opacity);
    }

    const shade = this._hillshade(tile, pixelX, pixelY);
    const value = 18 + shade * 150 * opacity;

    return gray(value);
  }

  private async _getTile(z: number, x: number, y: number): Promise<TerrainTile | null> {
    const key = `${z}/${x}/${y}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const promise = this._loadTile(z, x, y).then((tile) => {
      this.resolved.set(key, tile);
      return tile;
    });
    this.cache.set(key, promise);

    if (this.cache.size > 256) {
      const first = this.cache.keys().next().value;
      if (first) {
        this.cache.delete(first);
        this.resolved.delete(first);
      }
    }

    return promise;
  }

  private async _loadTile(z: number, x: number, y: number): Promise<TerrainTile | null> {
    try {
      const url = config.terrain.source
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
      const response = await fetch(url);
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      const png = PNG.sync.read(buffer);
      return { width: png.width, height: png.height, data: png.data };
    } catch {
      return null;
    }
  }

  private _elevation(tile: TerrainTile, x: number, y: number): number {
    x = clamp(x, 0, tile.width - 1);
    y = clamp(y, 0, tile.height - 1);

    const index = (y * tile.width + x) * 4;
    const r = tile.data[index];
    const g = tile.data[index + 1];
    const b = tile.data[index + 2];

    // Mapzen Terrarium encoding: elevation = red * 256 + green + blue / 256 - 32768
    return r * 256 + g + b / 256 - 32768;
  }

  private _hillshade(tile: TerrainTile, x: number, y: number): number {
    const west = this._elevation(tile, x - 1, y);
    const east = this._elevation(tile, x + 1, y);
    const north = this._elevation(tile, x, y - 1);
    const south = this._elevation(tile, x, y + 1);
    const dzdx = (east - west) / 2;
    const dzdy = (south - north) / 2;

    const azimuth = (360 - config.terrain.azimuth + 90) * Math.PI / 180;
    const altitude = config.terrain.altitude * Math.PI / 180;
    const lightX = Math.cos(altitude) * Math.cos(azimuth);
    const lightY = Math.cos(altitude) * Math.sin(azimuth);
    const lightZ = Math.sin(altitude);
    const normalZ = 24;
    const length = Math.sqrt(dzdx * dzdx + dzdy * dzdy + normalZ * normalZ);
    const normalX = -dzdx / length;
    const normalY = -dzdy / length;
    const normal = normalZ / length;

    return clamp(normalX * lightX + normalY * lightY + normal * lightZ, 0, 1);
  }

  private _elevationColor(elevation: number): string {
    const stops: Array<[number, string]> = [
      [-500, '#10283d'],
      [0, '#1b4a5a'],
      [200, '#245c34'],
      [900, '#6a6d38'],
      [1800, '#8a6d45'],
      [3000, '#b9b0a0'],
      [4500, '#f0f0f0'],
    ];

    if (elevation <= stops[0][0]) return stops[0][1];

    for (let index = 1; index < stops.length; index += 1) {
      const previous = stops[index - 1];
      const next = stops[index];

      if (elevation <= next[0]) {
        const t = (elevation - previous[0]) / (next[0] - previous[0]);
        return interpolateColor(previous[1], next[1], t);
      }
    }

    return stops[stops.length - 1][1];
  }
}
