'use strict';
const Tile = require('./Tile');

// a square ring; reversed it winds the other way round
const square = (x, y, size, reversed = false) => {
  const ring = [{x, y}, {x: x + size, y}, {x: x + size, y: y + size}, {x, y: y + size}, {x, y}];
  return reversed ? ring.reverse() : ring;
};

describe('Tile.classifyRings', () => {
  test('keeps a single ring as one polygon', () => {
    const ring = square(0, 0, 10);
    expect(Tile.classifyRings([ring])).toEqual([[ring]]);
  });

  test('puts holes into the polygon before them', () => {
    const outer = square(0, 0, 100);
    const hole = square(10, 10, 10, true);
    expect(Tile.classifyRings([outer, hole])).toEqual([[outer, hole]]);
  });

  test('splits several outer rings into separate polygons', () => {
    const first = square(0, 0, 100);
    const firstHole = square(10, 10, 10, true);
    const secondHole = square(210, 10, 10, true);
    const second = square(200, 0, 100);
    const third = square(400, 0, 50);
    expect(Tile.classifyRings([first, firstHole, second, secondHole, third]))
      .toEqual([[first, firstHole], [second, secondHole], [third]]);
  });

  test('works whichever way the outer rings wind', () => {
    const outer = square(0, 0, 100, true);
    const hole = square(10, 10, 10);
    const other = square(200, 0, 100, true);
    expect(Tile.classifyRings([outer, hole, other])).toEqual([[outer, hole], [other]]);
  });

  test('skips rings without area', () => {
    const outer = square(0, 0, 100);
    const flat = [{x: 0, y: 0}, {x: 5, y: 0}, {x: 0, y: 0}];
    expect(Tile.classifyRings([outer, flat])).toEqual([[outer]]);
  });
});

describe('Tile.cleanLabel', () => {
  test('turns line breaks and other control characters into spaces', () => {
    expect(Tile.cleanLabel('Whale watching\nFuturismo')).toBe('Whale watching Futurismo');
    expect(Tile.cleanLabel('a\t\r\nb\u0085c')).toBe('a b c');
  });

  test('keeps names as they are otherwise, and numbers as text', () => {
    expect(Tile.cleanLabel('Hawaiʻi Volcanoes')).toBe('Hawaiʻi Volcanoes');
    expect(Tile.cleanLabel(12)).toBe('12');
    expect(Tile.cleanLabel(' \n ')).toBe(undefined);
    expect(Tile.cleanLabel(undefined)).toBe(undefined);
  });
});
