'use strict';
const Tile = require('./Tile');

const square = (x, y, size, clockwise) => {
  const ring = [{x, y}, {x: x + size, y}, {x: x + size, y: y + size}, {x, y: y + size}, {x, y}];
  return clockwise ? ring : ring.reverse();
};

describe('Tile', () => {
  describe('_classifyRings', () => {
    const classify = rings => Tile.prototype._classifyRings(rings);

    test('keeps a single ring as one polygon', () => {
      const ring = square(0, 0, 10, true);
      expect(classify([ring])).toEqual([[ring]]);
    });

    test('attaches holes to the polygon before them', () => {
      const outer = square(0, 0, 10, true);
      const hole = square(2, 2, 2, false);
      expect(classify([outer, hole])).toEqual([[outer, hole]]);
    });

    test('splits a multipolygon into its polygons', () => {
      const a = square(0, 0, 10, true);
      const hole = square(2, 2, 2, false);
      const b = square(20, 0, 5, true);
      expect(classify([a, hole, b])).toEqual([[a, hole], [b]]);
    });

    test('skips degenerate rings', () => {
      const a = square(0, 0, 10, true);
      const flat = [{x: 0, y: 0}, {x: 5, y: 0}, {x: 0, y: 0}];
      expect(classify([a, flat])).toEqual([[a]]);
    });
  });
});
