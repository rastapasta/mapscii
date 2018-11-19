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
      expect(wrapper).toThrowError('isn\'t a supported hex color');
    });
  });
});
