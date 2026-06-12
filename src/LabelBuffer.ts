/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Using 2D spatial indexing to avoid overlapping labels and markers
  and to find labels underneath a mouse cursor's position
*/

import RBush from 'rbush';
import stringWidth from 'string-width';
import config from './config';
import { TileFeature } from './Tile';
import { displayLines, wrapText } from './textShaping';

export interface LabelItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  text: string;
  feature?: TileFeature;
}

interface LabelMeasurement {
  display: string;
  width: number;
  height: number;
}

export default class LabelBuffer {
  private tree: RBush<LabelItem>;
  private margin: number = 5;
  private widthCache: Map<string, number> = new Map();
  // Wrapping, bidi shaping, and width measurement are expensive (stringWidth
  // per word/line) and writeIfPossible runs per candidate position per
  // feature per frame - memoize the full measurement per unique text.
  private measurementCache: Map<string, LabelMeasurement> = new Map();

  constructor() {
    this.tree = new RBush<LabelItem>();
  }

  clear(): void {
    this.tree.clear();
  }

  // Project internal pixel coordinates to character cell coordinates
  // Always uses 2x4 (braille standard) - aspect correction is in map projection
  project(x: number, y: number): [number, number] {
    return [Math.floor(x / 2), Math.floor(y / 4)];
  }

  writeIfPossible(text: string, x: number, y: number, feature: TileFeature | null, margin?: number): boolean | LabelItem {
    margin = margin ?? this.margin;

    const measurement = this._measure(text);
    const point = this.project(x, y);

    // Collision-test with the margin-less box, insert the margin-padded one
    // (existing labels keep their breathing room, new ones can sit closer).
    if (this.tree.collides(this._areaFor(measurement, point[0], point[1], 0))) {
      return false;
    }

    const data = this._areaFor(measurement, point[0], point[1], margin);
    if (feature) {
      data.feature = feature;
    }
    this.tree.insert(data);
    return data;
  }

  featuresAt(x: number, y: number): LabelItem[] {
    return this.tree.search({ minX: x, maxX: x, minY: y, maxY: y });
  }

  private _measure(text: string): LabelMeasurement {
    // labelMaxWidth is part of the key so a runtime config change can't
    // serve stale wrapping.
    const cacheKey = `${config.labelMaxWidth}|${text}`;
    const cached = this.measurementCache.get(cacheKey);
    if (cached) return cached;

    const display = wrapText(text, config.labelMaxWidth);
    const lines = displayLines(display);
    let width = 1;
    for (const line of lines) {
      const lineWidth = this._textWidth(line);
      if (lineWidth > width) width = lineWidth;
    }

    const measurement: LabelMeasurement = {
      display,
      width,
      height: Math.max(1, lines.length),
    };

    if (this.measurementCache.size > 4096) this.measurementCache.clear();
    this.measurementCache.set(cacheKey, measurement);
    return measurement;
  }

  private _areaFor(measurement: LabelMeasurement, x: number, y: number, margin: number): LabelItem {
    return {
      minX: x - margin,
      minY: y - margin / 2,
      maxX: x + margin + measurement.width,
      maxY: y + measurement.height - 1 + margin / 2,
      text: measurement.display,
    };
  }

  private _textWidth(text: string): number {
    const cached = this.widthCache.get(text);
    if (cached !== undefined) return cached;
    const w = Math.max(1, stringWidth(text));
    if (this.widthCache.size > 4096) this.widthCache.clear();
    this.widthCache.set(text, w);
    return w;
  }
}
