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

  describe('resetCache', () => {
    test('clears in-memory tile caches', () => {
      config.persistDownloadedTiles = false;

      const tileSource = new TileSource();
      tileSource.cache['0-0-0'] = {} as never;
      tileSource.cached.push('0-0-0');

      const result = tileSource.resetCache({ persistent: false });

      expect(tileSource.cache).toEqual({});
      expect(tileSource.cached).toEqual([]);
      expect(result.memoryEntries).toBe(2);
      expect(result.errors).toEqual([]);
    });
  });
});
