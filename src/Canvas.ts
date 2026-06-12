/*
  MapSCII - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Canvas-like painting abstraction for BrailleBuffer
*/

import bresenham from 'bresenham';
import earcut from 'earcut';
import BrailleBuffer from './BrailleBuffer';
import { clipSegmentToRect } from './clipping';

export interface Point {
  x: number;
  y: number;
}

export default class Canvas {
  public width: number;
  public height: number;
  public buffer: BrailleBuffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.buffer = new BrailleBuffer(width, height);
  }

  frame(): string {
    return this.buffer.frame();
  }

  clear(): void {
    this.buffer.clear();
  }

  text(text: string, x: number, y: number, color: number, center: boolean = false): void {
    this.buffer.writeText(text, x, y, color, center);
  }

  line(from: Point, to: Point, color: number, width: number = 1): void {
    this._line(from.x, from.y, to.x, to.y, width, color);
  }

  polyline(points: Point[], color: number, width: number = 1): void {
    for (let i = 1; i < points.length; i++) {
      const x1 = points[i - 1].x;
      const y1 = points[i - 1].y;
      this._line(x1, y1, points[i].x, points[i].y, width, color);
    }
  }

  setBackground(color: number): void {
    this.buffer.setGlobalBackground(color);
  }

  setPixel(x: number, y: number, color: number): void {
    this.buffer.setPixel(x, y, color);
  }

  background(x: number, y: number, color: number): void {
    this.buffer.setBackground(x, y, color);
  }

  polygon(rings: Point[][], color: number): boolean {
    const outerRings: Point[][] = [];
    const innerRings: Point[][] = [];

    for (const ring of rings) {
      if (ring.length < 3) continue;
      const area = this._calculateArea(ring);

      if (area < 0) {
        outerRings.push(ring);
      } else {
        innerRings.push(ring);
      }
    }

    for (const outerRing of outerRings) {
      const vertices: number[] = [];
      const holes: number[] = [];

      for (const point of outerRing) {
        vertices.push(point.x);
        vertices.push(point.y);
      }

      const overlappingHoles = this._findOverlappingHoles(outerRing, innerRings);
      for (const hole of overlappingHoles) {
        if (hole.length >= 3) {
          holes.push(vertices.length / 2);
          for (const point of hole) {
            vertices.push(point.x);
            vertices.push(point.y);
          }
        }
      }

      let triangles: number[];
      try {
        triangles = earcut(vertices, holes);
      } catch {
        continue;
      }
      for (let i = 0; i < triangles.length; i += 3) {
        const pa = this._polygonExtract(vertices, triangles[i]);
        const pb = this._polygonExtract(vertices, triangles[i + 1]);
        const pc = this._polygonExtract(vertices, triangles[i + 2]);
        this._filledTriangle(pa, pb, pc, color);
      }
    }
    return true;
  }

  fillTriangle(a: Point, b: Point, c: Point, color: number): void {
    this._filledTriangle([a.x, a.y], [b.x, b.y], [c.x, c.y], color);
  }

  private _calculateArea(ring: Point[]): number {
    let area = 0;
    const n = ring.length;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
    }

    return area / 2;
  }

  private _findOverlappingHoles(outerRing: Point[], innerRings: Point[][]): Point[][] {
    const overlappingHoles: Point[][] = [];

    for (const hole of innerRings) {
      if (this._isPointInPolygon(hole[0], outerRing)) {
        overlappingHoles.push(hole);
      }
    }

    return overlappingHoles;
  }

  private _isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }

  private _polygonExtract(vertices: number[], pointId: number): [number, number] {
    return [vertices[pointId * 2], vertices[pointId * 2 + 1]];
  }

  // Inspired by Alois Zingl's "The Beauty of Bresenham's Algorithm"
  // -> http://members.chello.at/~easyfilter/bresenham.html
  private _line(x0: number, y0: number, x1: number, y1: number, width: number, color: number): void {
    // Clip to the buffer first: Bresenham walks every pixel of the segment,
    // so unclipped segments (which can span millions of pixels on the globe)
    // would block the event loop. The margin keeps wide strokes intact at edges.
    const margin = Math.max(4, width * 2);
    const clipped = clipSegmentToRect(
      { x: x0, y: y0 },
      { x: x1, y: y1 },
      -margin,
      -margin,
      this.width - 1 + margin,
      this.height - 1 + margin
    );
    if (!clipped) return;
    x0 = clipped[0].x;
    y0 = clipped[0].y;
    x1 = clipped[1].x;
    y1 = clipped[1].y;

    // Fall back to width-less bresenham algorithm if we dont have a width
    if (!(width = Math.max(0, width - 1))) {
      bresenham(x0, y0, x1, y1, (x: number, y: number) => {
        this.buffer.setPixel(x, y, color);
      });
      return;
    }

    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;

    let err = dx - dy;

    const ed = dx + dy === 0 ? 1 : Math.sqrt(dx * dx + dy * dy);

    width = (width + 1) / 2;

    while (true) {
      this.buffer.setPixel(x0, y0, color);
      let e2 = err;
      let x2 = x0;
      if (2 * e2 >= -dx) {
        e2 += dy;
        let y2 = y0;
        while (e2 < ed * width && (y1 !== y2 || dx > dy)) {
          this.buffer.setPixel(x0, y2 += sy, color);
          e2 += dx;
        }
        if (x0 === x1) {
          break;
        }
        e2 = err;
        err -= dy;
        x0 += sx;
      }
      if (2 * e2 <= dy) {
        e2 = dx - e2;
        while (e2 < ed * width && (x1 !== x2 || dx < dy)) {
          this.buffer.setPixel(x2 += sx, y0, color);
          e2 += dy;
        }
        if (y0 === y1) {
          break;
        }
        err += dx;
        y0 += sy;
      }
    }
  }

  private _filledRectangle(x: number, y: number, width: number, height: number, color: number): void {
    const pointA: [number, number] = [x, y];
    const pointB: [number, number] = [x + width, y];
    const pointC: [number, number] = [x, y + height];
    const pointD: [number, number] = [x + width, y + height];
    this._filledTriangle(pointA, pointB, pointC, color);
    this._filledTriangle(pointC, pointB, pointD, color);
  }

  // Draws a filled triangle using a scanline fill clamped to the buffer.
  // Cost is O(visible rows + visible pixels) regardless of how far the
  // vertices extend off-screen, so huge projected triangles stay cheap.
  private _filledTriangle(pointA: [number, number], pointB: [number, number], pointC: [number, number], color: number): void {
    const ax = pointA[0], ay = pointA[1];
    const bx = pointB[0], by = pointB[1];
    const cx = pointC[0], cy = pointC[1];

    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    const minX = Math.min(ax, bx, cx);
    const maxX = Math.max(ax, bx, cx);

    if (maxY < 0 || minY > this.height - 1 || maxX < 0 || minX > this.width - 1) {
      return;
    }

    const yStart = Math.max(0, Math.ceil(minY));
    const yEnd = Math.min(this.height - 1, Math.floor(maxY));

    // Thin horizontal sliver between two integer rows: still mark one row
    // so sub-pixel triangles don't vanish entirely.
    if (yEnd < yStart) {
      const y = Math.round((minY + maxY) / 2);
      if (y >= 0 && y < this.height) {
        const left = Math.max(0, Math.round(minX));
        const right = Math.min(this.width - 1, Math.round(maxX));
        for (let x = left; x <= right; x++) {
          this.buffer.setPixel(x, y, color);
        }
      }
      return;
    }

    for (let y = yStart; y <= yEnd; y++) {
      let left = Infinity;
      let right = -Infinity;

      // Intersect the scanline with each edge
      // Edge AB
      if ((ay <= y && y <= by) || (by <= y && y <= ay)) {
        if (ay === by) {
          left = Math.min(left, ax, bx);
          right = Math.max(right, ax, bx);
        } else {
          const x = ax + ((y - ay) * (bx - ax)) / (by - ay);
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      // Edge BC
      if ((by <= y && y <= cy) || (cy <= y && y <= by)) {
        if (by === cy) {
          left = Math.min(left, bx, cx);
          right = Math.max(right, bx, cx);
        } else {
          const x = bx + ((y - by) * (cx - bx)) / (cy - by);
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
      // Edge CA
      if ((cy <= y && y <= ay) || (ay <= y && y <= cy)) {
        if (cy === ay) {
          left = Math.min(left, cx, ax);
          right = Math.max(right, cx, ax);
        } else {
          const x = cx + ((y - cy) * (ax - cx)) / (ay - cy);
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }

      if (left > right) continue;

      // Round outward so adjacent triangles sharing an edge both cover the
      // boundary pixels (prevents hairline cracks between triangles).
      const xl = Math.max(0, Math.round(left - 0.25));
      const xr = Math.min(this.width - 1, Math.round(right + 0.25));
      for (let x = xl; x <= xr; x++) {
        this.buffer.setPixel(x, y, color);
      }
    }
  }
}
