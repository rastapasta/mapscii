'use strict';
const TileSource = require('./TileSource');

describe('TileSource', () => {
  describe('with a HTTP source', () => {
    test('sets the mode to 3', async () => {
      const tileSource = new TileSource();
      await tileSource.init('https://tiles.openfreemap.org/planet/map/');
      expect(tileSource.mode).toBe(3);
    });
  });
});
