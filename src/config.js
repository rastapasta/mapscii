module.exports = {
  language: 'en',

  // TODO: adapt to osm2vectortiles successor openmaptiles v3)
  // mapscii.me hosts the last available version, 2016-06-20
  source: 'https://mapscii.me/',

  // sources by name, e.g. --tile_source openfreemap
  sources: {
    // osm2vectortiles data from 2016, small tiles
    mapscii: 'https://mapscii.me/',
    // current OpenStreetMap data in the OpenMapTiles schema; more detail, about twice the size
    openfreemap: 'https://tiles.openfreemap.org/planet',
  },

  // 'osm2vectortiles' or 'openmaptiles'; null detects it from the TileJSON
  tileSchema: null,

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

  // a dense tile takes up to 25 MB, a city one ~5 MB; tiles on screen are kept beyond the budget
  tileCacheSize: 40,
  tileCacheMB: 200,
  // measured
  tileFeatureBytes: 480,
  // slow links are often limited per connection, so parallel downloads pay off
  maxConcurrentDownloads: 6,
  maxQueuedDownloads: 64,
  prefetch: true,
  maxConcurrentPrefetches: 4,
  maxConnections: 8,
  // give up when no data comes for this long, retry after tileRetryDelay
  tileRequestTimeout: 20000,
  connectAttemptTimeout: 5000,
  tileRequestRetries: 2,
  tileRetryDelay: 10000,
  maxFps: 30,
  // ms of tile reading between pauses, so keys stay responsive
  tileLoadSlice: 8,
  // --download: the most tiles at once, and the average stored tile size
  maxDownloadTiles: 200000,
  downloadTileKB: 30,

  tileRange: 14,
  projectSize: 256,

  labelMargin: 2,
  // names may show this many zoom levels early when there is room
  labelsEarly: 3,
  // longer names are shortened with "…"; clicking one shows it in full
  labelMaxWidth: 20,
  overlayColor: '#ff5f87',
  waypointMarker: '◆',
  notesColor: '#ffd75f',
  noteMarker: '●',
  trueColor: /truecolor|24bit/i.test(process.env.COLORTERM || ''),
  // imagery one zoom coarser than the map: enough for two pixels per cell, a quarter of the data
  imageryDetail: -1,
  terrainDetail: -2,
  // relief brightness under the map (lines need contrast)
  reliefBrightness: 0.7,

  gpsColor: '#5fffff',
  gpsMarker: '◉',
  gpsTrackPoints: 50000,
  // fleet devices not heard of for fleetStale seconds show how long ago
  fleetColor: '#ffaf5f',
  fleetMarker: '▲',
  fleetStale: 600,
  routeColor: '#87d7ff',
  indexDelay: 150,
  // below this share of cells drawn (and at most two names) the footer says little is mapped here
  sparseFilled: 0.3,
  printTimeout: 30000,
  // in pixels
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

  goToZoom: 14,
  // color: xterm-256 code
  locationMarker: '✚',
  locationMarkerColor: 196,
};
