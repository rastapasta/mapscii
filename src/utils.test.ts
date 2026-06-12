import { describe, expect, test } from 'bun:test';
import { hex2rgb, normalize } from './utils';

const hexCases: Array<[string, [number, number, number]]> = [
  ['#ff0000', [255, 0, 0]],
  ['#ffff00', [255, 255, 0]],
  ['#0000ff', [0, 0, 255]],
  ['#112233', [17, 34, 51]],
  ['#888', [136, 136, 136]],
];

describe('hex2rgb', () => {
  test.each(hexCases)('parses %s', (input, expected) => {
    expect(hex2rgb(input)).toEqual(expected);
  });

  test('throws for unsupported hex colors', () => {
    expect(() => hex2rgb('33')).toThrow('33 isn\'t a supported hex color');
  });
});

describe('normalize', () => {
  test.each([
    [0, 0, 0, 0],
    [61, 48, 61, 48],
    [-61, -48, -61, -48],
    [181, 85.06, -179, 85.0511],
    [-181, -85.06, 179, -85.0511],
  ])('normalizes lon=%f lat=%f', (lon, lat, expectedLon, expectedLat) => {
    expect(normalize({ lon, lat })).toEqual({ lon: expectedLon, lat: expectedLat });
  });
});
