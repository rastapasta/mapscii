/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Using 2D spatial indexing to avoid overlapping labels and markers
  and to find labels underneath a mouse cursor's position
*/

import RBush from 'rbush';
import stringWidth from 'string-width';
import { TileFeature } from './Tile';

export interface LabelItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  feature?: TileFeature;
}

export default class LabelBuffer {
  private tree: RBush<LabelItem>;
  private margin: number = 5;
  private widthCache: Map<string, number> = new Map();

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

    const point = this.project(x, y);

    if (this._hasSpace(text, point[0], point[1])) {
      const data = this._calculateArea(text, point[0], point[1], margin);
      if (feature) {
        data.feature = feature;
      }
      this.tree.insert(data);
      return data;
    } else {
      return false;
    }
  }

  featuresAt(x: number, y: number): LabelItem[] {
    return this.tree.search({ minX: x, maxX: x, minY: y, maxY: y });
  }

  private _hasSpace(text: string, x: number, y: number): boolean {
    return !this.tree.collides(this._calculateArea(text, x, y));
  }

  private _calculateArea(text: string, x: number, y: number, margin: number = 0): LabelItem {
    // Use cached stringWidth for accurate visual width calculation
    const visualWidth = this._textWidth(text);
    return {
      minX: x - margin,
      minY: y - margin / 2,
      maxX: x + margin + visualWidth,
      maxY: y + margin / 2,
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
