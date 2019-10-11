'use strict';
const utils = require('./utils');

describe('utils', () => {
  describe('hex2rgb', () => {
    describe.each([
      ['#ff0000', 255, 0, 0],
      ['#ffff00', 255, 255, 0],
      ['#0000ff', 0, 0, 255],
      ['#112233', 17, 34, 51],
      ['#888', 136, 136, 136],
    ])('when given "%s"', (input, r, g, b) => {
      test(`returns [${r},${g},${b}]`, () => {
        expect(utils.hex2rgb(input)).toEqual([r, g, b]);
      });
    });

    test('throws an Error when given "33"', () => {
      function wrapper() {
        utils.hex2rgb('33');
      }
      expect(wrapper).toThrow('isn\'t a supported hex color');
    });
  });
});

describe('normalize', () => {
  describe.each([
    [0, 0, 0, 0],
    [61, 48, 61, 48],
    [-61, -48, -61, -48],
    [181, 85.06, -179, 85.0511],
    [-181, -85.06, 179, -85.0511],
  ])('when given lon=%f and lat=%f', (lon, lat, expected_lon, expected_lat) => {
    const input = {
      lon,
      lat,
    };
    test(`returns lon=${expected_lon} and lat=${expected_lat}`, () => {
      const expected = {
        lon: expected_lon,
        lat: expected_lat,
      };
      expect(utils.normalize(input)).toEqual(expected);
    });
  });
});
