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

  // this area, snapped to screen pixels near Hopkinton, MA, used to hang earcut
  test('returns for a hole that shrank to a line', () => {
    const canvas = new Canvas(200, 200);
    const outer = ring(187, 111, 188, 112, 189, 111, 189, 112, 190, 112, 190, 113, 190, 112, 188, 112, 187, 111);
    const hole = ring(189, 112, 188, 112, 189, 112);
    expect(typeof canvas.polygon([outer, hole], 15)).toBe('boolean');
  });
});
