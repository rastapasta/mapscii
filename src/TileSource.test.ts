import { afterEach, describe, expect, test } from 'bun:test';
import config from './config';
import TileSource from './TileSource';

describe('TileSource', () => {
  const originalPersistDownloadedTiles = config.persistDownloadedTiles;

  afterEach(() => {
    config.persistDownloadedTiles = originalPersistDownloadedTiles;
  });

  describe('with an HTTP source', () => {
    test('sets the mode to HTTP', async () => {
      config.persistDownloadedTiles = false;

      const tileSource = new TileSource();
      await tileSource.init('https://tiles.openfreemap.org/planet/map/');

      expect(tileSource.mode).toBe(3);
    });
  });
});
