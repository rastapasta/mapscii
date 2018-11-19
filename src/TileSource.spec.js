'use strict';
const TileSource = require('./TileSource');

describe('TileSource', () => {
  describe('with a HTTP source', async () => {
    const tileSource = new TileSource();
    await tileSource.init('http://mapscii.me/');
    test('sets the mode to 3', () => {
      tileSource.mode = 3;
    });
  });
});
