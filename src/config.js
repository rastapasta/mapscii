module.exports = {
  language: 'en',

  // TODO: adapt to osm2vectortiles successor openmaptiles v3)
  // mapscii.me hosts the last available version, 2016-06-20
  source: 'https://mapscii.me/',

  //source: __dirname+"/../mbtiles/regensburg.mbtiles",

  styleFile: __dirname+'/../styles/dark.json',

  initialZoom: null,
  maxZoom: 18,
  zoomStep: 0.2,

  // sf lat: 37.787946, lon: -122.407522
  // iceland lat: 64.124229, lon: -21.811552
  // rgbg
  // lat: 49.019493, lon: 12.098341
  initialLat: 52.51298,
  initialLon: 13.42012,

  simplifyPolylines: false,

  useBraille: true,

  // Downloaded files get persisted in ~/.mapscii
  persistDownloadedTiles: true,

  // How many parsed tiles to keep in memory (a dense city tile takes ~5MB)
  tileCacheSize: 40,
  // Parallel downloads of visible tiles (like a web browser), and how many may wait in line.
  // Slow links are often limited per connection, so parallel downloads pay off.
  maxConcurrentDownloads: 6,
  maxQueuedDownloads: 64,
  // Download tiles around the view (and one zoom level in and out) when no visible tile is waiting
  prefetch: true,
  maxConcurrentPrefetches: 4,
  // Never more connections than this to the tile server
  maxConnections: 8,
  // Give up on a tile request after this many ms, and retry it after tileRetryDelay
  tileRequestTimeout: 20000,
  tileRetryDelay: 10000,
  // Upper limit for redraws per second
  maxFps: 30,

  tileRange: 14,
  projectSize: 256,

  // Free space (in characters) kept around each name
  labelMargin: 2,
  // Show every name there is room for, regardless of its zoom level in the style
  showAllLabels: true,
  // A repeated name (e.g. a long street) only shows again this far (in pixels) from its other copy
  labelRepeatDistance: {x: 80, y: 40},

  layers: {
    housenum_label: {
      margin: 1
    },
    poi_label: {
      cluster: true,
      margin: 2,
    },
    place_label: {
      cluster: true,
    },
    state_label: {
      cluster: true,
    },
  },

  input: process.stdin,
  output: process.stdout,

  headless: false,

  delimeter: '\n\r',

  poiMarker: '◉',
};
