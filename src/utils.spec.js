'use strict';
const utils = require('./utils');

describe('utils', () => {
  describe('hex2rgb', () => {
    test('#ff0000', () => {
      expect(utils.hex2rgb('#ff0000')).toEqual([255,0,0]);
    });
    test('#ffff00', () => {
      expect(utils.hex2rgb('#ffff00')).toEqual([255,255,0]);
    });
    test('#0000ff', () => {
      expect(utils.hex2rgb('#0000ff')).toEqual([0,0,255]);
    });
    test('#112233', () => {
      expect(utils.hex2rgb('#112233')).toEqual([17,34,51]);
    });
    test('#888', () => {
      expect(utils.hex2rgb('#888')).toEqual([136,136,136]);
    });
    test('33', () => {
      function wrapper() {
        utils.hex2rgb('33');
      }
      expect(wrapper).toThrowError('isn\'t a supported hex color');
    });
  });
});
