'use strict';
const Canvas = require('./Canvas');

const ring = (...coordinates) => {
  const points = [];
  for (let i = 0; i < coordinates.length; i += 2) {
    points.push({x: coordinates[i], y: coordinates[i + 1]});
  }
  return points;
};

describe('Canvas.polygon', () => {
  test('fills a polygon with a hole', () => {
    const canvas = new Canvas(40, 40);
    const outer = ring(0, 0, 30, 0, 30, 30, 0, 30);
    const hole = ring(10, 10, 10, 20, 20, 20, 20, 10);
    expect(canvas.polygon([outer, hole], 15)).toBe(true);
  });

  // a tile far below the zoom level (shown while the right one loads) has
  // shapes much larger than the screen; drawing them used to take seconds
  test('fills huge areas quickly, and only on the canvas', () => {
    const canvas = new Canvas(320, 176);
    const start = Date.now();
    const huge = ring(-500000, -400000, 900000, -300000, 200000, 800000);
    expect(canvas.polygon([huge], 15)).toBe(true);
    expect(Date.now() - start).toBeLessThan(200);
    expect(canvas.frameLines().join('')).toContain('\u28ff');
  });

  test('leaves out areas and holes outside the canvas', () => {
    const canvas = new Canvas(40, 40);
    expect(canvas.polygon([ring(100, 100, 130, 100, 130, 130)], 15)).toBe(false);
    const outer = ring(0, 0, 30, 0, 30, 30, 0, 30);
    const offscreenHole = ring(500, 500, 500, 510, 510, 510);
    expect(canvas.polygon([outer, offscreenHole], 15)).toBe(true);
  });

  // this area, snapped to screen pixels near Hopkinton, MA, used to hang earcut
  test('returns for a hole that shrank to a line', () => {
    const canvas = new Canvas(200, 200);
    const outer = ring(187, 111, 188, 112, 189, 111, 189, 112, 190, 112, 190, 113, 190, 112, 188, 112, 187, 111);
    const hole = ring(189, 112, 188, 112, 189, 112);
    expect(typeof canvas.polygon([outer, hole], 15)).toBe('boolean');
  });
});

describe('Canvas.polyline', () => {
  test('draws very long lines quickly, as far as they cross the canvas', () => {
    const canvas = new Canvas(320, 176);
    const start = Date.now();
    canvas.polyline([{x: -900000, y: 88}, {x: 900000, y: 88}], 15, 1);
    canvas.polyline([{x: 160, y: -700000}, {x: 160, y: 700000}], 15, 3);
    expect(Date.now() - start).toBeLessThan(200);
    const lines = canvas.frameLines();
    expect(lines[22]).toMatch(/[\u2801-\u28ff]/);
  });
});
