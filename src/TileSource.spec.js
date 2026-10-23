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
});

describe('TileSource sources', () => {
  // don't create cache folders for these made-up sources
  const config = require('./config');
  const persist = config.persistDownloadedTiles;
  beforeAll(() => config.persistDownloadedTiles = false);
  afterAll(() => config.persistDownloadedTiles = persist);

  test('a base URL gets the {z}/{x}/{y}.pbf path appended', async () => {
    const tileSource = new TileSource();
    await tileSource.init('https://example.org/tiles/');
    expect(tileSource.tileUrl).toBe('https://example.org/tiles/{z}/{x}/{y}.pbf');
    expect(tileSource.schema).toBe('osm2vectortiles');
  });

  test('a URL template is used as it is', async () => {
    const tileSource = new TileSource();
    await tileSource.init('https://example.org/{z}/{x}/{y}.mvt');
    expect(tileSource.tileUrl).toBe('https://example.org/{z}/{x}/{y}.mvt');
  });

  test('every source but mapscii.me gets its own cache folder', async () => {
    const mapscii = new TileSource();
    await mapscii.init('https://mapscii.me/');
    const other = new TileSource();
    await other.init('https://example.org/tiles/');
    expect(other.cacheDir).not.toBe(mapscii.cacheDir);
    expect(other.cacheDir.startsWith(mapscii.cacheDir)).toBe(true);
  });
});
