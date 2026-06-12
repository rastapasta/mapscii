/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Handling of and access to single VectorTiles
*/

import { VectorTile, VectorTileFeature } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { gunzip } from 'zlib';
import { promisify } from 'util';
import RBush from 'rbush';

import config from './config';
import Styler, { StyleLayer } from './Styler';
import { colorFromHex } from './color';
import { resolveStyleValue } from './styleValues';

const gunzipAsync = promisify(gunzip);

interface GeometryPoint {
  x: number;
  y: number;
}

// Properties from Mapbox vector tiles - common properties used in map styling
interface FeatureProperties {
  $type?: string;
  localrank?: number;
  scalerank?: number;
  name?: string;
  name_en?: string;
  class?: string;
  type?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface TileFeature {
  id?: number;
  layer: string;
  style: StyleLayer;
  geomType?: 'Point' | 'LineString' | 'Polygon';
  label?: string;
  sort?: number;
  points: GeometryPoint[] | GeometryPoint[][];
  color: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TileLayer {
  extent: number;
  tree: RBush<TileFeature>;
}

export interface SerializedTileFeature extends Omit<TileFeature, 'color' | 'style' | 'points'> {
  colorHex: string;
  // Style layers are referenced by id and rehydrated from the main-thread
  // styler - cloning style objects per feature through structured clone is
  // prohibitively slow.
  styleId: string;
  // Geometry lives in the payload's shared coords buffer: transferring one
  // ArrayBuffer is far cheaper than structured-cloning tens of thousands of
  // point objects. Layout starting at coordsOffset:
  // [ringCount, ringLength0, x, y, ..., ringLength1, x, y, ...]
  coordsOffset: number;
}

export interface SerializedTileLayer {
  extent: number;
  features: SerializedTileFeature[];
}

export interface ParsedTilePayload {
  layers: Record<string, SerializedTileLayer>;
  coords: Int32Array;
}

export default class Tile {
  public styler: Styler | null;
  public tile: VectorTile | null = null;
  public layers: Record<string, TileLayer> = {};
  public zoom: number = 0;

  constructor(styler: Styler | null) {
    this.styler = styler;
  }

  static fromParsedLayers(
    styler: Styler | null,
    payload: ParsedTilePayload,
    zoom: number
  ): Tile {
    const tile = new Tile(styler);
    tile.zoom = zoom;
    tile.layers = {};

    const coords = payload.coords;

    for (const name in payload.layers) {
      const layer = payload.layers[name];
      const features: TileFeature[] = [];
      for (const feature of layer.features) {
        const { colorHex, styleId, coordsOffset, ...rest } = feature;
        const style = styler?.styleById[styleId];
        if (!style) continue;

        // Decode the rings from the shared coords buffer
        // Layout: [ringCount, ringLength0, x, y, ..., ringLength1, x, y, ...]
        let offset = coordsOffset;
        const ringCount = coords[offset++];
        const rings: GeometryPoint[][] = new Array(ringCount);
        for (let r = 0; r < ringCount; r++) {
          const length = coords[offset++];
          const ring: GeometryPoint[] = new Array(length);
          for (let i = 0; i < length; i++) {
            ring[i] = { x: coords[offset], y: coords[offset + 1] };
            offset += 2;
          }
          rings[r] = ring;
        }

        features.push({
          ...rest,
          style,
          // Fill features keep all rings; others are one feature per ring
          points: style.type === 'fill' ? rings : rings[0],
          color: colorFromHex(colorHex),
        } as TileFeature);
      }
      if (features.length === 0) continue;

      const tree = new RBush<TileFeature>(18);
      tree.load(features);
      tile.layers[name] = {
        extent: layer.extent,
        tree,
      };
    }

    return tile;
  }

  async load(buffer: Buffer, zoom: number = 0): Promise<this> {
    this.zoom = zoom;
    const unzippedBuffer = await this._unzipIfNeeded(buffer);
    this._loadTile(unzippedBuffer);
    this._loadLayers(zoom);
    return this;
  }

  private _loadTile(buffer: Buffer): void {
    this.tile = new VectorTile(new Pbf(buffer));
  }

  private async _unzipIfNeeded(buffer: Buffer): Promise<Buffer> {
    if (this._isGzipped(buffer)) {
      return gunzipAsync(buffer) as Promise<Buffer>;
    }
    return buffer;
  }

  private _isGzipped(buffer: Buffer): boolean {
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  }

  private _loadLayers(zoom: number): Record<string, TileLayer> {
    const layers: Record<string, TileLayer> = {};
    const colorCache: Record<string, number> = {};

    if (!this.tile) return this.layers = layers;

    for (const name in this.tile.layers) {
      const layer = this.tile.layers[name];
      const nodes: TileFeature[] = [];

      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i) as VectorTileFeature & { properties: FeatureProperties };
        feature.properties.$type = [undefined, 'Point', 'LineString', 'Polygon'][feature.type];
        const geomType = feature.properties.$type as ('Point' | 'LineString' | 'Polygon' | undefined);

        let style: StyleLayer | false;
        if (this.styler) {
          style = this.styler.getStyleFor(name, feature);
          if (!style) {
            continue;
          }
        } else {
          continue;
        }

        const rawColor = (
          style.paint?.['line-color'] ||
          style.paint?.['fill-color'] ||
          style.paint?.['text-color']
        );

        // Skip if no color found
        if (!rawColor) continue;

        const color = resolveStyleValue(rawColor as string | { stops: [number, string][] }, zoom, '#ffffff');

        const colorCode = colorCache[color] || (colorCache[color] = colorFromHex(color));

        const geometries = feature.loadGeometry();
        const sort = (feature.properties.localrank as number | undefined) || (feature.properties.scalerank as number | undefined);
        const label = style.type === 'symbol'
          ? (feature.properties['name_' + config.language] as string | undefined) ||
          (feature.properties.name_en as string | undefined) ||
          (feature.properties.name as string | undefined) ||
          (feature.properties.house_num as string | undefined)
          : undefined;

        if (style.type === 'fill') {
          nodes.push(this._addBoundaries(true, {
            layer: name,
            style,
            geomType,
            label,
            sort,
            points: geometries,
            color: colorCode,
            minX: 0,
            maxX: 0,
            minY: 0,
            maxY: 0,
          }));
        } else {
          for (const points of geometries) {
            nodes.push(this._addBoundaries(false, {
              layer: name,
              style,
              geomType,
              label,
              sort,
              points,
              color: colorCode,
              minX: 0,
              maxX: 0,
              minY: 0,
              maxY: 0,
            }));
          }
        }
      }

      if (nodes.length === 0) {
        continue;
      }

      const tree = new RBush<TileFeature>(18);
      tree.load(nodes);
      layers[name] = {
        extent: layer.extent,
        tree,
      };
    }

    return this.layers = layers;
  }

  private _addBoundaries(deep: boolean, data: TileFeature): TileFeature {
    let minX = Number.MAX_VALUE;
    let maxX = -Number.MAX_VALUE;
    let minY = Number.MAX_VALUE;
    let maxY = -Number.MAX_VALUE;

    // For fill features (deep) the bbox must span ALL rings: water/landuse are
    // often multipolygons, and indexing only the first ring makes windowed
    // rbush searches miss the feature entirely (e.g. ocean missing from tiles).
    const rings = deep ? (data.points as GeometryPoint[][]) : [data.points as GeometryPoint[]];
    for (const ring of rings) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    data.minX = minX;
    data.maxX = maxX;
    data.minY = minY;
    data.maxY = maxY;
    return data;
  }
}
