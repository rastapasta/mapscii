module.exports = {
  language: 'en',

  // mapscii.me hosts the last osm2vectortiles version, 2016-06-20.
  // Tiles in its successor's schema, OpenMapTiles, work too: pass their
  // server with --tile_source and styles/openmaptiles-dark.json with --style_file.
  source: 'http://mapscii.me/',

  //source: __dirname+"/../mbtiles/regensburg.mbtiles",

  styleFile: __dirname+'/../styles/dark.json',

  initialZoom: null,
  maxZoom: 18,
  // Optional offline GeoNames FTS index, built with tools/maps-search-index.
  searchDatabase: process.env.MAPSCII_SEARCH_DB || null,
  sqliteCommand: process.env.MAPSCII_SQLITE || 'sqlite3',
  searchZoom: 14,
  zoomStep: 0.2,

  // sf lat: 37.787946, lon: -122.407522
  // iceland lat: 64.124229, lon: -21.811552
  // rgbg
  // lat: 49.019493, lon: 12.098341
  initialLat: 52.51298,
  initialLon: 13.42012,

  simplifyPolylines: false,

  useBraille: true,

  // false leaves the mouse to the terminal: no dragging or wheel zoom, but
  // text can be selected as usual
  useMouse: true,

  // Downloaded files get persisted in ~/.mapscii
  persistDownloadedTiles: true,

  tileRange: 14,
  projectSize: 256,

  labelMargin: 5,

  layers: {
    housenum_label: {
      margin: 4
    },
    poi_label: {
      cluster: true,
      margin: 5,
    },
    place_label: {
      cluster: true,
    },
    state_label: {
      cluster: true,
    },
    // the same layers in OpenMapTiles
    housenumber: {
      margin: 4
    },
    poi: {
      cluster: true,
      margin: 5,
    },
    place: {
      cluster: true,
    },
  },

  input: process.stdin,
  output: process.stdout,

  headless: false,

  delimeter: '\n\r',

  poiMarker: '◉',
};
