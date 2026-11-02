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

describe('TileSource.looksLikeTile', () => {
  const zlib = require('zlib');
  // a layer (field 3) of 2 bytes, then another of 0 bytes
  const tile = Buffer.from([0x1a, 0x02, 0x08, 0x01, 0x1a, 0x00]);

  test('accepts vector tiles, gzipped or not, and empty ones', () => {
    expect(TileSource.looksLikeTile(tile)).toBe(true);
    expect(TileSource.looksLikeTile(zlib.gzipSync(tile))).toBe(true);
    expect(TileSource.looksLikeTile(Buffer.alloc(0))).toBe(true);
  });

  test('turns away error pages and broken downloads', () => {
    expect(TileSource.looksLikeTile(Buffer.from('<html><body>Please log in</body></html>'))).toBe(false);
    expect(TileSource.looksLikeTile(tile.slice(0, 5))).toBe(false);
    expect(TileSource.looksLikeTile(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x12, 0x34]))).toBe(false);
  });
});

describe('TileSource.plainText', () => {
  test('makes one line of plain text out of an HTML attribution', () => {
    expect(TileSource.plainText('<a href="x">&copy; OpenMapTiles</a>\n<a>&copy; OpenStreetMap</a>')).toBe('© OpenMapTiles © OpenStreetMap');
  });

  test('drops control characters, which could change the terminal', () => {
    expect(TileSource.plainText('Map\u001b[2J data\u0007')).toBe('Map [2J data');
    expect(TileSource.plainText(42)).toBe('42');
  });
});

describe('TileSource.areaTiles', () => {
  const tileSource = new TileSource();
  const count = (tiles, z) => tiles.filter((tile) => tile.z === z).length;

  test('covers both sides of the date line', () => {
    const tiles = tileSource.areaTiles(-17.7, 179.9, 30, 8);
    const xs = new Set(tiles.filter((tile) => tile.z === 8).map((tile) => tile.x));
    expect(xs.has(255)).toBe(true);
    expect(xs.has(0)).toBe(true);
  });

  test('covers each tile once, also when the area is wider than the world', () => {
    const tiles = tileSource.areaTiles(0, 0, 30000, 3);
    expect(count(tiles, 0)).toBe(1);
    expect(count(tiles, 3)).toBe(64);
    expect(new Set(tiles.map((t) => `${t.z}/${t.x}/${t.y}`)).size).toBe(tiles.length);
  });

  test('counts the tiles without listing them', () => {
    for (const [lat, lon, km, z] of [[-17.7, 179.9, 30, 8], [0, 0, 30000, 3], [84.9, 10, 50, 6], [42.36, -71.09, 5, 14]]) {
      expect(tileSource.countAreaTiles(lat, lon, km, z)).toBe(tileSource.areaTiles(lat, lon, km, z).length);
    }
  });

  test('stays within the map near the poles', () => {
    const tiles = tileSource.areaTiles(84.9, 10, 50, 6);
    for (const tile of tiles) {
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(Math.pow(2, tile.z));
    }
  });
});
