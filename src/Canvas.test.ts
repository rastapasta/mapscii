/*
  Smoke tests for the rasterization hot paths.

  These guard the two failure modes that made the globe unusable:
  - triangle fill cost must be bounded by the visible area, not by how far
    the vertices extend off-screen (previously OOM-crashed at high zoom)
  - partially off-screen triangles must fill solid spans (previously
    rendered as broken stripes)
*/

import { test, expect } from 'bun:test';
import Canvas from './Canvas';
import { clipSegmentToRect, clipPolylineToRect } from './clipping';

const FULL_BRAILLE = String.fromCharCode(0x28ff); // all 8 dots set

function frameOf(canvas: Canvas): string {
  return canvas.frame();
}

test('fillTriangle with far off-screen vertices completes quickly and fills the screen', () => {
  const canvas = new Canvas(560, 240);

  const start = performance.now();
  // Triangle covering the whole viewport, vertices millions of pixels away
  canvas.fillTriangle(
    { x: -2_000_000, y: -1_000_000 },
    { x: 2_000_000, y: -1_000_000 },
    { x: 0, y: 3_000_000 },
    50
  );
  const elapsed = performance.now() - start;

  // Previously this allocated tens of millions of edge points and crashed.
  expect(elapsed).toBeLessThan(500);

  // The whole visible area must be filled solid
  const frame = frameOf(canvas);
  const solidCells = frame.split('').filter((c) => c === FULL_BRAILLE).length;
  expect(solidCells).toBeGreaterThan((560 / 2) * (240 / 4) * 0.95);
});

test('partially off-screen triangle fills solid spans (no stripes)', () => {
  const canvas = new Canvas(100, 100);

  // Apex far above the screen, base far below: every on-screen row crosses
  // the two side edges and must be filled between them.
  canvas.fillTriangle(
    { x: 50, y: -10_000 },
    { x: -5_000, y: 10_000 },
    { x: 5_000, y: 10_000 },
    50
  );

  const frame = frameOf(canvas);
  const solidCells = frame.split('').filter((c) => c === FULL_BRAILLE).length;
  // Triangle covers the entire 50x25-cell viewport at these coordinates
  expect(solidCells).toBeGreaterThan((100 / 2) * (100 / 4) * 0.95);
});

test('tiny triangles still mark at least one pixel', () => {
  const canvas = new Canvas(40, 40);
  canvas.fillTriangle({ x: 10, y: 10.2 }, { x: 12, y: 10.4 }, { x: 11, y: 10.3 }, 50);
  const frame = frameOf(canvas);
  const blank = String.fromCharCode(0x2800);
  expect(frame.split('').some((c) => c !== blank && c.charCodeAt(0) >= 0x2800 && c.charCodeAt(0) <= 0x28ff)).toBe(true);
});

test('clipSegmentToRect clamps crossing segments and rejects outside ones', () => {
  const inside = clipSegmentToRect({ x: -100, y: 50 }, { x: 200, y: 50 }, 0, 0, 99, 99);
  expect(inside).not.toBeNull();
  expect(inside![0]).toEqual({ x: 0, y: 50 });
  expect(inside![1]).toEqual({ x: 99, y: 50 });

  const outside = clipSegmentToRect({ x: -100, y: -50 }, { x: -10, y: -5 }, 0, 0, 99, 99);
  expect(outside).toBeNull();
});

test('clipPolylineToRect splits polylines that leave and re-enter the rect', () => {
  const parts = clipPolylineToRect(
    [
      { x: 10, y: 10 },
      { x: 90, y: 10 },   // inside
      { x: 90, y: -500 }, // leaves through the top
      { x: 10, y: -500 }, // stays outside
      { x: 10, y: 90 },   // re-enters
    ],
    0, 0, 99, 99
  );
  expect(parts.length).toBe(2);
  for (const part of parts) {
    expect(part.length).toBeGreaterThanOrEqual(2);
    for (const p of part) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(99);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(99);
    }
  }
});

test('line drawing with far off-screen endpoints stays fast', () => {
  const canvas = new Canvas(560, 240);
  const start = performance.now();
  // Previously Bresenham walked every one of the ~4M pixels of this segment
  for (let i = 0; i < 100; i++) {
    canvas.line({ x: -2_000_000, y: 120 + i }, { x: 2_000_000, y: 120 - i }, 50);
  }
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(500);
});
