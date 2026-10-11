'use strict';
const TileSource = require('./TileSource');

describe('TileSource', () => {
  describe('with a HTTP source', () => {
    test('sets the mode to 3', async () => {
      const tileSource = new TileSource();
      await tileSource.init('http://mapscii.me/');
      expect(tileSource.mode).toBe(3);
    });
  });

  describe('cacheDir', () => {
    test('keeps one folder per tile source', () => {
      const own = TileSource.cacheDir('http://mapscii.me/');
      const local = TileSource.cacheDir('http://127.0.0.1:8080/');
      const other = TileSource.cacheDir('http://127.0.0.1:8081/');
      expect(local).not.toBe(own);
      expect(local).not.toBe(other);
      expect(local.startsWith(own)).toBe(true);
      expect(TileSource.cacheDir('http://127.0.0.1:8080/')).toBe(local);
    });
  });
});
