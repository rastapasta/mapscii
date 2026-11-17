/*
  termap - Terminal Map Viewer
  by Michael Strassburger <codepoet@cpan.org>

  Canvas-like painting abstraction for BrailleBuffer

  Implementation inspired by node-drawille-canvas (https://github.com/madbence/node-drawille-canvas)
  * added support for filled polygons
  * improved text rendering

  Will most likely be turned into a stand alone module at some point
 */
'use strict';
const bresenham = require('bresenham');
const earcut = require('earcut');
const BrailleBuffer = require('./BrailleBuffer');

class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.buffer = new BrailleBuffer(width, height);
  }

  // The frame as one string
  frame() {
    return this.buffer.frame();
  }

  // The frame as one string per row
  frameLines() {
    return this.buffer.frameLines();
  }

  // Empties the canvas
  clear() {
    this.buffer.clear();
  }

  // Writes text at a pixel
  text(text, x, y, color, center = false) {
    this.buffer.writeText(text, x, y, color, center);
  }

  // Draws a line between two points
  line(from, to, color, width = 1) {
    this._clippedLine(from.x, from.y, to.x, to.y, width, color);
  }

  // Draws a line through the points
  polyline(points, color, width = 1) {
    for (let i = 1; i < points.length; i++) {
      this._clippedLine(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, width, color);
    }
  }

  // Only the part of a line that can reach the canvas: overzoomed tiles make very long lines.
  _clippedLine(x0, y0, x1, y1, width, color) {
    const margin = width + 1;
    const segment = clipSegment(x0, y0, x1, y1, -margin, -margin, this.width - 1 + margin, this.height - 1 + margin);
    if (segment) {
      this._line(segment[0], segment[1], segment[2], segment[3], width, color);
    }
  }

  // Restricts drawing to an area, or lifts it with null
  setClip(clip) {
    this.buffer.setClip(clip);
  }

  // Sets the background colour of the whole canvas
  setBackground(color) {
    this.buffer.setGlobalBackground(color);
  }

  // Sets the background colour of the cell at a pixel
  background(x, y, color) {
    this.buffer.setBackground(x, y, color);
  }

  // Fills a polygon with holes, by triangulating it
  polygon(rings, color) {
    const vertices = [];
    const holes = [];
    const visible = {
      minX: this.buffer.clipMinX,
      minY: this.buffer.clipMinY,
      maxX: this.buffer.clipMaxX - 1,
      maxY: this.buffer.clipMaxY - 1,
    };
    for (const ring of rings) {
      if (vertices.length) {
        // Skip holes off screen or degenerate: they hide nothing, slow earcut, and can hang it.
        if (ring.length < 3 || !ringArea(ring) || !overlaps(ring, visible)) continue;
        holes.push(vertices.length / 2);
      } else {
        if (ring.length < 3 || !overlaps(ring, visible)) return false;
      }
      for (const point of ring) {
        vertices.push(point.x);
        vertices.push(point.y);
      }
    }

    let triangles;
    try {
      triangles = earcut(vertices, holes);
    } catch (error) {
      return false;
    }
    for (let i = 0; i < triangles.length; i += 3) {
      const pa = this._polygonExtract(vertices, triangles[i]);
      const pb = this._polygonExtract(vertices, triangles[i + 1]);
      const pc = this._polygonExtract(vertices, triangles[i + 2]);
      this._filledTriangle(pa, pb, pc, color);
    }
    return true;
  }

  // The point with this index in a flat vertex list
  _polygonExtract(vertices, pointId) {
    return [vertices[pointId * 2], vertices[pointId * 2 + 1]];
  }

  // Inspired by Alois Zingl's "The Beauty of Bresenham's Algorithm"
  // -> http://members.chello.at/~easyfilter/bresenham.html
  _line(x0, y0, x1, y1, width, color) {
    // Fall back to width-less bresenham algorithm if we dont have a width
    if (!(width = Math.max(0, width - 1))) {
      return bresenham(x0, y0, x1, y1, (x, y) => {
        return this.buffer.setPixel(x, y, color);
      });
    }

    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;

    let err = dx - dy;

    const ed = dx + dy === 0 ? 1 : Math.sqrt(dx * dx + dy * dy);

    width = (width + 1) / 2;

    /* eslint-disable no-constant-condition */
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
    /* eslint-enable */
  }

  // Fills a rectangle as two triangles
  _filledRectangle(x, y, width, height, color) {
    const pointA = [x, y];
    const pointB = [x + width, y];
    const pointC = [x, y + height];
    const pointD = [x + width, y + height];
    this._filledTriangle(pointA, pointB, pointC, color);
    this._filledTriangle(pointC, pointB, pointD, color);
  }

  // row by row within the canvas, so the work doesn't grow with the triangle
  _filledTriangle(pointA, pointB, pointC, color) {
    const top = Math.max(0, Math.min(pointA[1], pointB[1], pointC[1]));
    const bottom = Math.min(this.height - 1, Math.max(pointA[1], pointB[1], pointC[1]));
    const edges = [[pointA, pointB], [pointB, pointC], [pointC, pointA]];
    for (let y = top; y <= bottom; y++) {
      let left = Infinity;
      let right = -Infinity;
      for (const [p, q] of edges) {
        const low = Math.min(p[1], q[1]);
        const high = Math.max(p[1], q[1]);
        if (y < low || y > high) continue;
        if (low === high) {
          left = Math.min(left, p[0], q[0]);
          right = Math.max(right, p[0], q[0]);
          continue;
        }
        const from = Math.max(low, y - 0.5);
        const to = Math.min(high, y + 0.5);
        const slope = (q[0] - p[0]) / (q[1] - p[1]);
        const xFrom = p[0] + (from - p[1]) * slope;
        const xTo = p[0] + (to - p[1]) * slope;
        left = Math.min(left, Math.round(Math.min(xFrom, xTo)));
        right = Math.max(right, Math.round(Math.max(xFrom, xTo)));
      }
      left = Math.max(0, left);
      right = Math.min(this.width - 1, right);
      for (let x = left; x <= right; x++) {
        this.buffer.setPixel(x, y, color);
      }
    }
  }
}

// Liang-Barsky clipping: rounded [x0, y0, x1, y1], or null
function clipSegment(x0, y0, x1, y1, minX, minY, maxX, maxY) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const checks = [[-dx, x0 - minX], [dx, maxX - x0], [-dy, y0 - minY], [dy, maxY - y0]];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [
    Math.round(x0 + t0 * dx), Math.round(y0 + t0 * dy),
    Math.round(x0 + t1 * dx), Math.round(y0 + t1 * dy),
  ];
}

// Whether the bounding box of the points overlaps the area
function overlaps(points, area) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return maxX >= area.minX && minX <= area.maxX && maxY >= area.minY && minY <= area.maxY;
}

// twice the ring's area (shoelace)
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x - ring[i].x) * (ring[i].y + ring[j].y);
  }
  return Math.abs(sum);
}

Canvas.prototype.stack = [];

module.exports = Canvas;
