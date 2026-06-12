/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  The Console Vector Tile renderer
*/

import x256 from 'x256';
import simplify from 'simplify-js';
import stringWidth from 'string-width';

import Canvas, { Point } from './Canvas';
import LabelBuffer, { LabelItem } from './LabelBuffer';
import Styler, { MapStyle } from './Styler';
import { hex2rgb, baseZoom, ll2tile, tilesizeAtZoom, LatLon } from './utils';
import config from './config';
import TileSource from './TileSource';
import { TileFeature, TileLayer } from './Tile';
import { Marker, MarkerStore } from './Markers';
import { clipPolylineToRect } from './clipping';
import { generateDrawOrder, isLabelLayer } from './drawOrder';

// Re-export Marker type for convenience
export type { Marker } from './Markers';

interface RenderTile {
  xyz: { x: number; y: number; z: number };
  zoom: number;
  position: { x: number; y: number };
  size: number;
  data?: { layers?: Record<string, TileLayer> };
  layers?: Record<string, { scale: number; extent: number; features: TileFeature[] }>;
}

export default class Renderer {
  public output: NodeJS.WriteStream;
  public tileSource: TileSource;
  public labelBuffer: LabelBuffer;
  public styler: Styler;
  public width: number = 0;
  public height: number = 0;
  public canvas: Canvas | null = null;
  public isDrawing: boolean = false;
  public lastDrawAt: number = 0;
  public tilePadding: number = 64;
  private _seen: Record<string, boolean> = {};
  private _markerStore: MarkerStore = new MarkerStore();
  private _textWidthCache: Map<string, number> = new Map();

  public terminal = {
    CLEAR: '\x1B[2J',
    MOVE: '\x1B[?6h',
  };

  constructor(output: NodeJS.WriteStream, tileSource: TileSource, style: MapStyle) {
    this.output = output;
    this.tileSource = tileSource;
    this.labelBuffer = new LabelBuffer();
    this.styler = new Styler(style);
    this.tileSource.useStyler(this.styler);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas = new Canvas(width, height);
  }

  // Marker management using MarkerStore (Issue #35, #97)
  get markerStore(): MarkerStore {
    return this._markerStore;
  }

  setMarkers(markers: Marker[]): void {
    this._markerStore.setMarkers(markers);
  }

  addMarker(marker: Marker): void {
    this._markerStore.upsertMarker(marker);
  }

  clearMarkers(): void {
    this._markerStore.clearMarkers();
  }

  getMarkers(): Marker[] {
    return this._markerStore.getMarkers();
  }

  async draw(center: LatLon, zoom: number): Promise<string> {
    if (this.isDrawing) return Promise.reject(new Error('Already drawing'));
    this.isDrawing = true;

    this.labelBuffer.clear();
    this._seen = {};

    const bgStyle = this.styler.styleById['background'];
    const color = bgStyle?.paint?.['background-color'];

    if (color && this.canvas) {
      this.canvas.setBackground(x256(hex2rgb(color)));
    }

    if (this.canvas) {
      this.canvas.clear();
    }

    try {
      const tiles = this._visibleTiles(center, zoom);
      await Promise.all(tiles.map(async (tile) => {
        // A single failing tile (network hiccup, missing tile) shouldn't
        // abort the whole frame - render what we have.
        try {
          await this._getTile(tile);
        } catch {
          return;
        }
        this._getTileFeatures(tile, zoom);
      }));
      this._renderTiles(tiles);
      this._renderMarkers(center, zoom);
      return this._getFrame();
    } catch (e) {
      console.error(e);
      throw e;
    } finally {
      this.isDrawing = false;
      this.lastDrawAt = Date.now();
    }
  }

  private _visibleTiles(center: LatLon, zoom: number): RenderTile[] {
    const z = baseZoom(zoom);
    const centerTile = ll2tile(center.lon, center.lat, z);

    const tiles: RenderTile[] = [];
    const tileSize = tilesizeAtZoom(zoom);

    // Aspect ratio correction (Issue #26)
    const cellWidth = config.cellGeometry?.width || 2;
    const cellHeight = config.cellGeometry?.height || 4;
    const standardRatio = 4 / 2;
    const actualRatio = cellHeight / cellWidth;
    const aspectY = standardRatio / actualRatio;

    const gridSize = Math.pow(2, z);

    // Compute ONE shared world->screen origin for the whole frame.
    // This avoids per-tile floating-point drift at fractional zoom (tileSize is non-integer)
    // which otherwise becomes visible as 1px "jumps" at tile seams when using floor().
    const centerPx = centerTile.x * tileSize;
    const centerPy = centerTile.y * tileSize;
    const originX = this.width / 2 - centerPx;
    const originY = this.height / 2 - centerPy * aspectY;
    const tileSizeY = tileSize * aspectY;

    // Add 1 extra tile on each side for smooth scrolling
    const tilesX = Math.ceil(this.width / tileSize / 2) + 1;
    const tilesY = Math.ceil(this.height / tileSizeY / 2) + 1;

    const baseX = Math.floor(centerTile.x);
    const baseY = Math.floor(centerTile.y);

    for (let ty = baseY - tilesY; ty <= baseY + tilesY; ty++) {
      for (let tx = baseX - tilesX; tx <= baseX + tilesX; tx++) {
        // screen position must use UNWRAPPED tx to keep dateline wrapping seamless
        const position = {
          x: originX + tx * tileSize,
          y: originY + ty * tileSizeY,
        };

        // wrap x only for fetching
        let fetchX = tx % gridSize;
        if (fetchX < 0) fetchX = z === 0 ? 0 : fetchX + gridSize;

        const xyz = { x: fetchX, y: ty, z };

        if (
          xyz.y < 0 || xyz.y >= gridSize ||
          position.x + tileSize < 0 ||
          position.y + tileSizeY < 0 ||
          position.x > this.width ||
          position.y > this.height
        ) {
          continue;
        }

        tiles.push({ xyz, zoom, position, size: tileSize });
      }
    }

    return tiles;
  }

  private async _getTile(tile: RenderTile): Promise<RenderTile> {
    tile.data = await this.tileSource.getTile(tile.xyz.z, tile.xyz.x, tile.xyz.y);
    return tile;
  }

  private _getTileFeatures(tile: RenderTile, zoom: number): RenderTile {
    const position = tile.position;
    const layers: Record<string, { scale: number; extent: number; features: TileFeature[] }> = {};
    const drawOrder = generateDrawOrder(zoom);

    for (const layerId of drawOrder) {
      const layer = (tile.data?.layers || {})[layerId] as TileLayer | undefined;
      if (!layer) {
        continue;
      }

      const extent = layer.extent;
      const scale = extent / tilesizeAtZoom(zoom);
      const searchPadding = this.tilePadding * scale;
      layers[layerId] = {
        scale,
        extent,
        features: layer.tree.search({
          minX: (-position.x - searchPadding) * scale,
          minY: (-position.y - searchPadding) * scale,
          maxX: (this.width - position.x + searchPadding) * scale,
          maxY: (this.height - position.y + searchPadding) * scale,
        }),
      };
    }
    tile.layers = layers;
    return tile;
  }

  private _renderTiles(tiles: RenderTile[]): void {
    const labels: { tile: RenderTile; feature: TileFeature; scale: number; extent: number }[] = [];
    if (tiles.length === 0) return;

    const drawOrder = generateDrawOrder(tiles[0].xyz.z);
    for (const layerId of drawOrder) {
      // Skip label/symbol layers entirely if noLabels is enabled
      const labelLayer = isLabelLayer(layerId);
      if (config.noLabels && labelLayer) {
        continue;
      }
      for (const tile of tiles) {
        const layer = tile.layers?.[layerId];
        if (!layer) continue;
        for (const feature of layer.features) {
          if (labelLayer) {
            labels.push({
              tile,
              feature,
              scale: layer.scale,
              extent: layer.extent
            });
          } else {
            this._drawFeature(tile, feature, layer.scale, layer.extent);
          }
        }
      }
    }

    // Skip rendering labels if noLabels is enabled
    if (config.noLabels) return;

    labels.sort((a, b) => {
      return (a.feature.sort || 0) - (b.feature.sort || 0);
    });

    for (const label of labels) {
      this._drawFeature(label.tile, label.feature, label.scale, label.extent);
    }
  }

  // Render custom markers on the map (Issue #35, #97)
  private _renderMarkers(center: LatLon, zoom: number): void {
    const markers = this._markerStore.getMarkers();
    if (!this.canvas || markers.length === 0) return;

    const z = baseZoom(zoom);
    const centerTile = ll2tile(center.lon, center.lat, z);
    const tileSize = tilesizeAtZoom(zoom);

    // Aspect ratio correction (Issue #26)
    const cellWidth = config.cellGeometry?.width || 2;
    const cellHeight = config.cellGeometry?.height || 4;
    const standardRatio = 4 / 2;
    const actualRatio = cellHeight / cellWidth;
    const aspectY = standardRatio / actualRatio;

    // Use same stable origin as _visibleTiles for consistency at fractional zoom
    const centerPx = centerTile.x * tileSize;
    const centerPy = centerTile.y * tileSize;
    const originX = this.width / 2 - centerPx;
    const originY = this.height / 2 - centerPy * aspectY;
    const tileSizeY = tileSize * aspectY;

    for (const marker of markers) {
      const markerTile = ll2tile(marker.lon, marker.lat, z);

      // Calculate pixel position using the stable origin
      const x = Math.round(originX + markerTile.x * tileSize);
      const y = Math.round(originY + markerTile.y * tileSizeY);

      // Skip if outside visible area
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
        continue;
      }

      const color = marker.color ?? x256(hex2rgb('#ff0000'));
      const glyph = marker.glyph || config.poiMarker;

      // Draw marker glyph
      this.canvas.text(glyph, x, y, color);

      // Try to place label if provided
      if (marker.label) {
        // Use stringWidth for accurate visual width (handles unicode like ⚲)
        const glyphWidth = stringWidth(glyph);
        const labelX = x + glyphWidth * 2;  // *2 because internal coords are 2x cell width
        // Use LabelBuffer to avoid collision with other labels
        if (this.labelBuffer.writeIfPossible(marker.label, labelX, y, null, config.labelMargin)) {
          this.canvas.text(marker.label, labelX, y, color);
        }
      }
    }
  }

  private _getFrame(): string {
    let frame = '';
    if (!this.lastDrawAt) {
      frame += this.terminal.CLEAR;
    }
    frame += this.terminal.MOVE;
    frame += this.canvas?.frame() || '';
    return frame;
  }

  featuresAt(x: number, y: number): LabelItem[] {
    return this.labelBuffer.featuresAt(x, y);
  }

  /**
   * When a polygon is clipped to a tile, the clipping algorithm often introduces
   * artificial segments along the tile boundary to "close" rings.
   * If we render polygon outlines by stroking these rings, we get visible tile seams.
   *
   * Fix: for polygon rings rendered as lines, drop border segments created by clipping.
   *
   * Important: vector-tile coords are usually in [0, extent-1], not [0, extent].
   * So we treat a 1-unit band near borders as "tile edge".
   */
  private _splitPolygonRingDropTileClosureSegments(ring: Point[], extent: number): Point[][] {
    if (!ring || ring.length < 2) return [];

    // Remove explicit duplicate closing coordinate if present.
    // We handle closure ourselves via wrap-around (i -> i+1 mod n).
    const pts = ring.slice();
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first && last && first.x === last.x && first.y === last.y) {
      pts.pop();
    }

    const n = pts.length;
    if (n < 2) return [];

    // Vector-tile coords are typically integer in [0, extent-1].
    // Treat a small band as "on the edge" so we also catch extent-1.
    const EDGE_TOL = 1; // tile-coordinate units
    const onLeft = (p: Point) => p.x <= EDGE_TOL;
    const onTop = (p: Point) => p.y <= EDGE_TOL;
    const onRight = (p: Point) => p.x >= (extent - EDGE_TOL);
    const onBottom = (p: Point) => p.y >= (extent - EDGE_TOL);

    // Only drop segments that are clearly "tile closure":
    // - axis-aligned
    // - both endpoints lie on the SAME tile border side
    const isTileClosureSegment = (a: Point, b: Point): boolean => {
      // Degenerate segment: ignore it (it would just spam pixels)
      if (a.x === b.x && a.y === b.y) return true;

      const horizontal = a.y === b.y;
      const vertical = a.x === b.x;

      if (horizontal) {
        if ((onTop(a) && onTop(b)) || (onBottom(a) && onBottom(b))) return true;
      }
      if (vertical) {
        if ((onLeft(a) && onLeft(b)) || (onRight(a) && onRight(b))) return true;
      }
      return false;
    };

    const parts: Point[][] = [];
    let current: Point[] = [];

    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];

      if (current.length === 0) current.push(a);

      if (isTileClosureSegment(a, b)) {
        if (current.length >= 2) parts.push(current);
        current = [];
      } else {
        current.push(b);
      }
    }

    if (current.length >= 2) parts.push(current);

    // Clean consecutive duplicates that can appear due to wrap/breaks
    return parts
      .map((part) => {
        const cleaned: Point[] = [];
        for (const p of part) {
          const prev = cleaned[cleaned.length - 1];
          if (!prev || prev.x !== p.x || prev.y !== p.y) cleaned.push(p);
        }
        return cleaned;
      })
      .filter((part) => part.length >= 2);
  }

  private _drawFeature(tile: RenderTile, feature: TileFeature, scale: number, extent: number): boolean {
    if (feature.style.minzoom !== undefined && tile.zoom < feature.style.minzoom) {
      return false;
    } else if (feature.style.maxzoom !== undefined && tile.zoom > feature.style.maxzoom) {
      return false;
    }

    if (!this.canvas) return false;

    let placed: boolean;

    switch (feature.style.type) {
      case 'line': {
        let width = feature.style.paint?.['line-width'] as number | { stops: [number, number][] };
        if (typeof width === 'object') {
          width = width.stops[0][1];
        }

        const raw = feature.points as Point[];

        // If this "line" actually comes from a Polygon ring, drop tile-edge closure artifacts.
        const tileSpaceParts =
          feature.geomType === 'Polygon'
            ? this._splitPolygonRingDropTileClosureSegments(raw, extent)
            : [raw];

        for (const tilePart of tileSpaceParts) {
          // Use clip+split approach to avoid "shortcut chords" when segments cross offscreen
          const screenParts = this._scaleReduceAndClipLine(tile, feature, tilePart, scale);
          for (const pts of screenParts) {
            if (pts.length >= 2) this.canvas.polyline(pts, feature.color, width as number);
          }
        }
        break;
      }
      case 'fill': {
        const polygonPoints = (feature.points as Point[][]).map((p: Point[]) => {
          return this._scaleAndReduce(tile, feature, p, scale, false);
        });
        this.canvas.polygon(polygonPoints, feature.color);
        break;
      }
      case 'symbol': {
        // Skip all symbol/text rendering when noLabels is enabled
        if (config.noLabels) {
          return false;
        }

        const labelText = feature.label;
        const text = labelText || config.poiMarker;

        // De-dupe only for truly global-ish labels (place names tend to duplicate across tiles)
        const seenKey = labelText ? `${feature.layer}|${labelText}` : '';
        if (labelText && feature.layer === 'place' && this._seen[seenKey]) return false;

        placed = false;
        const candidates = this._symbolCandidateScreenPoints(tile, feature.points as Point[], scale);
        const textW = this._textWidth(text); // terminal columns

        for (const point of candidates) {
          // internal coordinates are 2 "pixels" per terminal column
          const x = point.x - Math.floor(textW / 2) * 2;
          const layerConfig = config.layers[feature.layer];
          const margin = layerConfig?.margin || config.labelMargin;
          if (this.labelBuffer.writeIfPossible(text, x, point.y, feature, margin)) {
            this.canvas.text(text, x, point.y, feature.color);
            placed = true;
            break;
          } else {
            const cluster = layerConfig?.cluster;
            if (cluster && this.labelBuffer.writeIfPossible(config.poiMarker, point.x, point.y, feature, 3)) {
              this.canvas.text(config.poiMarker, point.x, point.y, feature.color);
              placed = true;
              break;
            }
          }
        }
        if (placed && labelText && feature.layer === 'place') this._seen[seenKey] = true;
        break;
      }
    }
    return true;
  }

  private _scaleAndReduce(tile: RenderTile, feature: TileFeature, points: Point[], scale: number, filter: boolean = true): Point[] {
    let lastX: number | undefined;
    let lastY: number | undefined;
    let outside = false;
    const scaled: Point[] = [];

    const minX = -this.tilePadding;
    const minY = -this.tilePadding;
    const maxX = this.width + this.tilePadding;
    const maxY = this.height + this.tilePadding;

    // Aspect ratio correction for non-standard terminal fonts (Issue #26)
    // Standard braille assumes 2x4 cells. For different aspect ratios:
    // - cellGeometry 2x4 = standard, aspectY = 1.0
    // - cellGeometry 2x2 (square) = aspectY = 2.0 (double Y to compensate)
    // - cellGeometry 1x2 = aspectY = 1.0 (same ratio as standard)
    const cellWidth = config.cellGeometry?.width || 2;
    const cellHeight = config.cellGeometry?.height || 4;
    const standardRatio = 4 / 2;  // Standard braille cell h/w ratio
    const actualRatio = cellHeight / cellWidth;
    const aspectY = standardRatio / actualRatio;

    for (const point of points) {
      // Round (not floor) to avoid a systematic negative bias.
      // Combined with the shared origin in _visibleTiles, this prevents 1px seam "jumps"
      // at high / fractional zoom.
      const x = Math.round(tile.position.x + (point.x / scale));
      const y = Math.round(tile.position.y + (point.y / scale) * aspectY);
      if (lastX === x && lastY === y) {
        continue;
      }
      lastY = y;
      lastX = x;
      if (filter) {
        const nowOutside = (x < minX || x > maxX || y < minY || y > maxY);
        if (nowOutside) {
          if (outside) continue;
          outside = true;
        } else {
          outside = false;
        }
      }
      scaled.push({ x, y });
    }
    if (feature.style.type !== 'symbol') {
      if (scaled.length < 2) {
        return [];
      }
      if (config.simplifyPolylines) {
        return simplify(scaled, 0.5, true);
      } else {
        return scaled;
      }
    } else {
      return scaled;
    }
  }

  /**
   * Scale, reduce, and clip polylines to viewport - avoiding "shortcut chords"
   * when segments cross offscreen areas. Returns an array of polyline parts.
   */
  private _scaleReduceAndClipLine(
    tile: RenderTile,
    feature: TileFeature,
    points: Point[],
    scale: number
  ): Point[][] {
    // same viewport padding rect used by old logic
    const minX = -this.tilePadding;
    const minY = -this.tilePadding;
    const maxX = this.width + this.tilePadding;
    const maxY = this.height + this.tilePadding;

    // Aspect ratio correction (same as _scaleAndReduce)
    const cellWidth = config.cellGeometry?.width || 2;
    const cellHeight = config.cellGeometry?.height || 4;
    const standardRatio = 4 / 2;
    const actualRatio = cellHeight / cellWidth;
    const aspectY = standardRatio / actualRatio;

    // 1) scale points (no "outside collapse")
    const scaled: Point[] = [];
    let lastX: number | undefined;
    let lastY: number | undefined;

    for (const p of points) {
      const x = Math.round(tile.position.x + (p.x / scale));
      const y = Math.round(tile.position.y + (p.y / scale) * aspectY);

      if (lastX === x && lastY === y) continue;
      lastX = x;
      lastY = y;
      scaled.push({ x, y });
    }

    if (scaled.length < 2) return [];

    // 2) clip + split into visible parts (prevents "shortcut chords")
    const parts = clipPolylineToRect(scaled, minX, minY, maxX, maxY);

    // 3) optional simplify per part (safe now: no giant invisible jumps)
    if (config.simplifyPolylines) {
      return parts
        .map((part) => (part.length >= 2 ? simplify(part, 0.5, true) : part))
        .map((part) =>
          part.map((pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) }))
        )
        .filter((part) => part.length >= 2);
    }

    return parts;
  }

  private _textWidth(text: string): number {
    const cached = this._textWidthCache.get(text);
    if (cached !== undefined) return cached;
    const w = Math.max(1, stringWidth(text));
    if (this._textWidthCache.size > 4096) this._textWidthCache.clear();
    this._textWidthCache.set(text, w);
    return w;
  }

  /**
   * Generate a SMALL set of on-screen candidate anchor points for a symbol feature.
   * This avoids the old "try every vertex" behavior which kills FPS on line labels.
   */
  private _symbolCandidateScreenPoints(tile: RenderTile, points: Point[], scale: number): Point[] {
    if (!points || points.length === 0) return [];

    const minX = -this.tilePadding;
    const minY = -this.tilePadding;
    const maxX = this.width + this.tilePadding;
    const maxY = this.height + this.tilePadding;

    // Aspect ratio correction (same as elsewhere)
    const cellWidth = config.cellGeometry?.width || 2;
    const cellHeight = config.cellGeometry?.height || 4;
    const standardRatio = 4 / 2;
    const actualRatio = cellHeight / cellWidth;
    const aspectY = standardRatio / actualRatio;

    const n = points.length;

    // Pick a handful of indices (priority: center-ish first)
    const idxs: number[] = [];
    const pushIdx = (i: number) => {
      if (i < 0 || i >= n) return;
      if (idxs.indexOf(i) !== -1) return;
      idxs.push(i);
    };

    pushIdx(Math.floor(n / 2));
    pushIdx(Math.floor(n / 4));
    pushIdx(Math.floor((3 * n) / 4));
    pushIdx(0);
    pushIdx(n - 1);

    if (n > 20) {
      const step = Math.max(1, Math.floor(n / 8)); // at most ~8 more samples
      for (let i = 0; i < n && idxs.length < 12; i += step) pushIdx(i);
    }

    const out: Point[] = [];
    const seen = new Set<string>();

    for (const i of idxs) {
      const p = points[i];
      const x = Math.round(tile.position.x + (p.x / scale));
      const y = Math.round(tile.position.y + (p.y / scale) * aspectY);

      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const key = `${x},${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y });
      if (out.length >= 8) break; // hard cap: keep it cheap
    }

    // If all sampled points were offscreen (can happen for long lines),
    // do a very cheap coarse scan to find any visible point.
    if (out.length === 0 && n > 0) {
      const step = Math.max(1, Math.floor(n / 32)); // scan <= 32 points
      for (let i = 0; i < n; i += step) {
        const p = points[i];
        const x = Math.round(tile.position.x + (p.x / scale));
        const y = Math.round(tile.position.y + (p.y / scale) * aspectY);
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        out.push({ x, y });
        break;
      }
    }

    return out;
  }

}
